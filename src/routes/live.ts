import { Router } from 'express';
import type { Response } from 'express';
import { join } from 'node:path';

import type { RuntimeEnv } from '../config/env.js';
import { demoCorpus } from '../demo/corpus.js';
import { LiveNewsPresetProvider } from '../demo/live-preset-provider.js';
import { LiveAgentSessionService } from '../demo/live-session.js';
import {
  ARC_DYNAMIC_PRESET_SOURCES,
  liveNewsPresets,
  type LiveNewsPreset
} from '../demo/news-presets.js';
import type { SourceImportMode, SourceMetadata, SourceType } from '../domain/extraction/types.js';
import {
  SUPPORTED_NEWS_SOURCE_LABELS,
  type ImportedArticle,
  type SupportedNewsSite
} from '../domain/news-import/index.js';
import {
  buildPreviewText,
  buildDetailSourceStatus,
  buildEvidenceDetail,
  buildJudgments,
  createLiveWorkbenchViewModel,
  extractSentences,
  formatImportModeLabel,
  formatImportStatusLabel,
  getDisplayHeadline,
  getDisplaySourceTitle,
  getDisplaySource,
  getEntities,
  getCurrentObjectCardTone,
  getPageStateSummary,
  getPhaseLabel,
  getGraphPresentationMode,
  getRelations,
  getSourceMetadata,
  getStepStatus,
  getSummary,
  getTotalPrice,
  hasStableWorkbenchResult,
  inferEventType,
  inferImportance,
  isGeneratedSourceTitle,
  shouldAcceptLiveSnapshot
} from './live-workbench.js';
import { createLivePollFailureTracker, isLiveSessionTerminalStatus } from './live-polling.js';
import { getArcExplorerBaseUrl } from '../support/arc-explorer.js';
import {
  collectRuntimeSensitiveValues,
  extractSafeErrorMessage,
  sanitizeSensitiveValue
} from '../support/sensitive.js';

type NewsImporter = {
  import: (articleUrl: string) => Promise<ImportedArticle>;
};

type CreateLiveRouterOptions = {
  liveSessionService: LiveAgentSessionService;
  runtimeEnv: RuntimeEnv;
  newsImporter: NewsImporter;
};

type CreateSessionBody = {
  title?: unknown;
  text?: unknown;
  sourceType?: unknown;
  articleUrl?: unknown;
  metadata?: unknown;
};

type ParsedCreateSessionBody =
  | {
      kind: 'text';
      input: {
        title?: string;
        text: string;
        sourceType?: SourceType;
        metadata?: SourceMetadata;
      };
    }
  | {
      kind: 'link';
      articleUrl: string;
    }
  | {
      kind: 'invalid';
      message: string;
    };

const SUPPORTED_SOURCE_SITE_VALUES = new Set<SupportedNewsSite>(['wublock123', 'panews', 'chaincatcher']);
const SUPPORTED_IMPORT_MODES = new Set<SourceImportMode>(['manual', 'link', 'preset']);
const SUPPORTED_IMPORT_STATUSES = new Set<SourceMetadata['importStatus']>(['live', 'cache']);
const LIVE_PRODUCT_BASE_PATH = '/arc/sd/live';
const LIVE_BRAND_LOGO_URL = `${LIVE_PRODUCT_BASE_PATH}/brand/logo.png`;
const LIVE_BRAND_LOGO_PATH = join(process.cwd(), 'docs', 'pic', 'logo.png');

const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const trimToUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidSourceType = (value: unknown): value is SourceType =>
  value === undefined || value === 'news' || value === 'research';

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeMetadata = (
  metadata: unknown
):
  | {
      ok: true;
      metadata?: SourceMetadata;
    }
  | {
      ok: false;
      message: string;
    } => {
  if (metadata === undefined) {
    return {
      ok: true,
      metadata: undefined
    };
  }

  if (!isPlainObject(metadata)) {
    return {
      ok: false,
      message: 'metadata 必须是对象。'
    };
  }

  const articleUrl = trimToUndefined(metadata.articleUrl);
  const sourceSite = trimToUndefined(metadata.sourceSite);
  const importMode = trimToUndefined(metadata.importMode);

  if (articleUrl && !isValidHttpUrl(articleUrl)) {
    return {
      ok: false,
      message: 'metadata.articleUrl 必须是合法的 http/https URL。'
    };
  }

  if (sourceSite && !SUPPORTED_SOURCE_SITE_VALUES.has(sourceSite as SupportedNewsSite)) {
    return {
      ok: false,
      message: `metadata.sourceSite 仅支持 ${Object.values(SUPPORTED_NEWS_SOURCE_LABELS).join('、')}。`
    };
  }

  if (importMode && !SUPPORTED_IMPORT_MODES.has(importMode as SourceImportMode)) {
    return {
      ok: false,
      message: 'metadata.importMode 仅支持 manual、link、preset。'
    };
  }

  if (metadata.importStatus !== undefined && !SUPPORTED_IMPORT_STATUSES.has(metadata.importStatus as SourceMetadata['importStatus'])) {
    return {
      ok: false,
      message: 'metadata.importStatus 仅支持 live、cache。'
    };
  }

  const normalizedMetadata: SourceMetadata = {
    ...(articleUrl ? { articleUrl } : {}),
    ...(sourceSite ? { sourceSite: sourceSite as SupportedNewsSite } : {}),
    ...(importMode ? { importMode: importMode as SourceImportMode } : {}),
    ...(trimToUndefined(metadata.importStatus) ? { importStatus: metadata.importStatus as 'live' | 'cache' } : {}),
    ...(trimToUndefined(metadata.cachedAt) ? { cachedAt: trimToUndefined(metadata.cachedAt) } : {})
  };

  return {
    ok: true,
    metadata: Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : undefined
  };
};

const parseCreateSessionBody = (body: CreateSessionBody): ParsedCreateSessionBody => {
  const text = trimToUndefined(body.text);
  const articleUrl = trimToUndefined(body.articleUrl);

  if (text && articleUrl) {
    return {
      kind: 'invalid',
      message: 'text 与 articleUrl 不能同时提交。'
    };
  }

  if (!text && !articleUrl) {
    return {
      kind: 'invalid',
      message: '必须提供 text 或 articleUrl 其中之一。'
    };
  }

  if (!isValidSourceType(body.sourceType)) {
    return {
      kind: 'invalid',
      message: 'sourceType 仅支持 news 或 research。'
    };
  }

  const normalizedMetadata = normalizeMetadata(body.metadata);

  if (!normalizedMetadata.ok) {
    return {
      kind: 'invalid',
      message: normalizedMetadata.message
    };
  }

  if (articleUrl) {
    if (!isValidHttpUrl(articleUrl)) {
      return {
        kind: 'invalid',
        message: 'articleUrl 必须是合法的 http/https URL。'
      };
    }

    return {
      kind: 'link',
      articleUrl
    };
  }

  return {
    kind: 'text',
    input: {
      ...(trimToUndefined(body.title) ? { title: trimToUndefined(body.title) } : {}),
      text: text!,
      ...(body.sourceType ? { sourceType: body.sourceType as SourceType } : {}),
      ...(normalizedMetadata.metadata ? { metadata: normalizedMetadata.metadata } : {})
    }
  };
};

const extractErrorMessage = (runtimeEnv: RuntimeEnv, error: unknown): string => {
  return extractSafeErrorMessage(error, '新闻导入失败。', {
    sensitiveValues: collectRuntimeSensitiveValues(runtimeEnv)
  });
};

const isAntiBotImportError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('反爬挑战页');

const logLiveRoute = (
  runtimeEnv: RuntimeEnv,
  message: string,
  details: Record<string, unknown>
): void => {
  if (runtimeEnv.nodeEnv === 'test') {
    return;
  }

  const safeDetails = sanitizeSensitiveValue(details, {
    sensitiveValues: collectRuntimeSensitiveValues(runtimeEnv)
  });

  console.log(`[live-route] ${message} ${JSON.stringify(safeDetails, null, 0)}`);
};

const applyNoStoreHeaders = (response: Response): void => {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');
};

const renderLiveConsolePage = (runtimeEnv: RuntimeEnv, presets: LiveNewsPreset[] = liveNewsPresets): string => {
  const sample = demoCorpus[0];
  const isLiveSessionTerminalStatusSource = isLiveSessionTerminalStatus.toString();
  const createLivePollFailureTrackerSource = createLivePollFailureTracker.toString();
  const recommendedTrialCards = ARC_DYNAMIC_PRESET_SOURCES.map(
    (source, index) => `
      <article class="trial-link-card">
        <span class="trial-link-source">${escapeHtml(SUPPORTED_NEWS_SOURCE_LABELS[source.sourceSite])}</span>
        <strong>${escapeHtml(source.title)}</strong>
        <span class="trial-link-url">${escapeHtml(source.articleUrl)}</span>
        <div class="trial-link-actions">
          <button
            type="button"
            class="secondary trial-fill-button"
            data-trial-link="${escapeHtml(source.articleUrl)}"
            data-testid="trial-fill-button-${index}"
          >一键填入</button>
          <a
            class="secondary trial-open-link"
            href="${escapeHtml(source.articleUrl)}"
            target="_blank"
            rel="noreferrer"
            aria-label="${escapeHtml(source.title)}"
            data-testid="trial-link-${index}"
          >查看原文</a>
        </div>
      </article>
    `
  ).join('');
  const presetCards = presets
    .map(
      (preset) => `
        <article
          class="preset-launcher card-detail-trigger"
          data-preset-id="${escapeHtml(preset.id)}"
          data-detail-payload="${escapeHtml(JSON.stringify({
            kind: 'preset',
            kicker: preset.origin === 'dynamic' ? 'Arc 实时线索' : '预置资讯卡',
            title: preset.title,
            subtitle: SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite],
            mainLabel: '摘要',
            mainText: preset.excerpt,
            quoteLabel: '原始片段',
            quote: preset.text.split('\n\n').slice(0, 2).join('\n\n'),
            source: SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite],
            presetTitle: preset.title,
            presetSource: SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite],
            presetSummary: preset.excerpt,
            cacheNote: '已预置完整材料，可直接进入分析。',
            actions: [
              { type: 'preset-launch', label: '直接启动分析', presetId: preset.id },
              { type: 'link', label: '查看原文', href: preset.articleUrl }
            ]
          }))}"
          tabindex="0"
          role="button"
        >
          <div class="preset-meta">
            <span>${escapeHtml(preset.origin === 'dynamic' ? 'Arc 实时线索' : SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite])}</span>
            <span>${escapeHtml(new URL(preset.articleUrl).hostname)}</span>
          </div>
          <h3>${escapeHtml(preset.title)}</h3>
          <p class="preset-excerpt">${escapeHtml(preset.excerpt)}</p>
          <p class="preset-snippet">${escapeHtml(preset.text.split('\n\n')[0])}</p>
          <button
            type="button"
            class="secondary preset-launch-button"
            data-preset-id="${escapeHtml(preset.id)}"
            data-testid="preset-launch-${escapeHtml(preset.id)}"
          >直接分析</button>
        </article>
      `
    )
    .join('');

  return `<!DOCTYPE html>
  <html lang="zh-CN" data-theme="light">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Arc Signal Desk</title>
      <link rel="icon" type="image/png" href="${LIVE_BRAND_LOGO_URL}" />
      <link rel="shortcut icon" type="image/png" href="${LIVE_BRAND_LOGO_URL}" />
      <script>
        try {
          if (window.localStorage.getItem('live-workbench-theme') === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
        } catch {}
      </script>
      <style>
        html[data-theme="light"] {
          color-scheme: light;
        }

        :root {
          color-scheme: dark;
          --bg: #050912;
          --bg-secondary: #0b121e;
          --panel: rgba(11, 17, 28, 0.84);
          --panel-strong: rgba(9, 14, 24, 0.96);
          --panel-soft: rgba(16, 24, 36, 0.72);
          --paper: rgba(8, 13, 23, 0.9);
          --ink: #edf4fb;
          --ink-strong: #ffffff;
          --muted: #93a4b8;
          --line: rgba(124, 143, 166, 0.22);
          --line-strong: rgba(134, 231, 212, 0.22);
          --accent: #86e7d4;
          --accent-strong: #8cc6ff;
          --accent-soft: rgba(140, 198, 255, 0.16);
          --gold: #d6a96c;
          --danger: #fb7185;
          --success: #34d399;
          --shadow: rgba(2, 8, 23, 0.54);
        }

        html[data-theme="light"] {
          --ink: #223649;
          --ink-strong: #102132;
          --muted: #5a6b7d;
          --line: rgba(77, 94, 117, 0.14);
          --line-strong: rgba(15, 114, 120, 0.18);
          --accent: #0f7278;
          --accent-strong: #3b82f6;
          --accent-soft: rgba(59, 130, 246, 0.08);
          --gold: #b7793e;
          --danger: #be123c;
          --success: #15803d;
          --shadow: rgba(15, 23, 42, 0.08);
        }

        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif;
          color: var(--ink);
          background:
            radial-gradient(circle at 12% 0%, rgba(140, 198, 255, 0.18), transparent 24rem),
            radial-gradient(circle at 88% 8%, rgba(134, 231, 212, 0.14), transparent 18rem),
            radial-gradient(circle at 50% 120%, rgba(214, 169, 108, 0.08), transparent 26rem),
            linear-gradient(180deg, #07101b 0%, var(--bg) 40%, #02060d 100%);
          min-height: 100vh;
          position: relative;
        }

        body::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(rgba(148, 163, 184, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.04) 1px, transparent 1px);
          background-size: 120px 120px;
          mask-image: radial-gradient(circle at center, black, transparent 88%);
        }

        html[data-theme="light"] body {
          background:
            radial-gradient(circle at 10% 0%, rgba(59, 130, 246, 0.1), transparent 22rem),
            radial-gradient(circle at 88% 6%, rgba(15, 114, 120, 0.08), transparent 18rem),
            linear-gradient(180deg, #fcfcf9 0%, #f4f8fb 52%, #eef2f5 100%);
        }

        html[data-theme="light"] body::before {
          background:
            linear-gradient(rgba(14, 165, 233, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(14, 165, 233, 0.05) 1px, transparent 1px);
        }

        main {
          max-width: 1540px;
          margin: 0 auto;
          padding: 20px 24px 56px;
          position: relative;
          z-index: 1;
        }

        .control-strip,
        .toolbelt-shell {
          margin-bottom: 14px;
          padding: 18px 22px;
        }

        .control-strip h1 {
          margin: 0 0 8px;
          font-size: clamp(2rem, 3.35vw, 3.1rem);
          line-height: 0.98;
          letter-spacing: 0;
          color: var(--ink-strong);
        }

        .control-grid,
        .toolbelt-actions {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
          margin-top: 14px;
        }

        .control-card {
          border-radius: 16px;
          border: 1px solid var(--line);
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(8, 16, 28, 0.84));
          padding: 13px 14px 14px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
          transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
        }

        .control-card[data-card-tone="ready"] {
          border-color: rgba(140, 198, 255, 0.24);
          background:
            linear-gradient(180deg, rgba(13, 24, 40, 0.92), rgba(8, 16, 28, 0.86));
        }

        .control-card[data-card-tone="running"] {
          border-color: rgba(94, 234, 212, 0.34);
          background:
            linear-gradient(180deg, rgba(10, 29, 40, 0.94), rgba(8, 18, 30, 0.9));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 16px 32px rgba(8, 145, 178, 0.12);
        }

        .control-card[data-card-tone="completed"] {
          border-color: rgba(52, 211, 153, 0.3);
          background:
            linear-gradient(180deg, rgba(8, 28, 28, 0.94), rgba(7, 18, 20, 0.88));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 14px 28px rgba(16, 185, 129, 0.1);
        }

        .control-card[data-card-tone="failed"] {
          border-color: rgba(251, 113, 133, 0.28);
          background:
            linear-gradient(180deg, rgba(42, 13, 20, 0.94), rgba(23, 8, 12, 0.9));
        }

        .control-card[data-card-tone="ready"] .control-label,
        .control-card[data-card-tone="running"] .control-label {
          color: var(--accent-strong);
        }

        .control-card[data-card-tone="completed"] .control-label {
          color: #86efac;
        }

        .control-card[data-card-tone="failed"] .control-label {
          color: #fda4af;
        }

        .control-card-wide {
          grid-column: span 2;
        }

        .control-label {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 8px;
        }

        .control-value {
          font-size: 16px;
          line-height: 1.45;
          color: var(--ink-strong);
        }

        .control-card[data-card-tone="ready"] .control-value {
          color: #dbeafe;
        }

        .control-card[data-card-tone="running"] .control-value {
          color: #f0fdfa;
        }

        .control-card[data-card-tone="completed"] .control-value {
          color: #d1fae5;
        }

        .control-card[data-card-tone="failed"] .control-value {
          color: #ffe4e6;
        }

        .hero, .panel {
          background:
            linear-gradient(180deg, rgba(10, 19, 33, 0.92), rgba(7, 14, 24, 0.86));
          border: 1px solid var(--line);
          border-radius: 28px;
          box-shadow:
            0 30px 70px var(--shadow),
            inset 0 1px 0 rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          position: relative;
          overflow: hidden;
        }

        .hero::before,
        .panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(125deg, rgba(94, 234, 212, 0.08), transparent 34%, rgba(56, 189, 248, 0.04)),
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 16rem);
          pointer-events: none;
        }

        .hero > *,
        .panel > * {
          position: relative;
          z-index: 1;
        }

        .command-deck {
          border-color: rgba(56, 189, 248, 0.18);
        }

        .workbench-shell {
          border-color: rgba(94, 234, 212, 0.14);
        }

        .signal-sidebar .sidebar-card {
          background:
            linear-gradient(180deg, rgba(8, 17, 29, 0.94), rgba(5, 12, 22, 0.88));
        }

        html[data-theme="light"] .hero,
        html[data-theme="light"] .panel {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 250, 255, 0.92));
          box-shadow:
            0 26px 52px rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.64);
        }

        html[data-theme="light"] .panel::before,
        html[data-theme="light"] .hero::before {
          background:
            linear-gradient(125deg, rgba(14, 165, 233, 0.08), transparent 34%, rgba(20, 184, 166, 0.05)),
            radial-gradient(circle at top right, rgba(14, 165, 233, 0.08), transparent 16rem);
        }

        html[data-theme="light"] .control-card,
        html[data-theme="light"] .source-drawer,
        html[data-theme="light"] .source-drawer[open],
        html[data-theme="light"] .preset-card,
        html[data-theme="light"] .preset-launcher,
        html[data-theme="light"] .stage-card,
        html[data-theme="light"] .overview-card,
        html[data-theme="light"] .sidebar-card,
        html[data-theme="light"] .judgment-card,
        html[data-theme="light"] .evidence-card,
        html[data-theme="light"] .deep-reading-card,
        html[data-theme="light"] .detail-panel,
        html[data-theme="light"] .detail-section,
        html[data-theme="light"] .detail-context-card,
        html[data-theme="light"] .graph-modal-panel,
        html[data-theme="light"] .graph-preview,
        html[data-theme="light"] .graph-surface,
        html[data-theme="light"] .metric-tile,
        html[data-theme="light"] .evidence-item {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(244, 249, 255, 0.92));
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
        }

        html[data-theme="light"] .control-card[data-card-tone="ready"] {
          border-color: rgba(59, 130, 246, 0.16);
          background:
            linear-gradient(180deg, rgba(243, 248, 255, 0.98), rgba(235, 244, 255, 0.96));
        }

        html[data-theme="light"] .control-card[data-card-tone="running"] {
          border-color: rgba(14, 165, 233, 0.26);
          background:
            linear-gradient(180deg, rgba(236, 250, 255, 0.98), rgba(224, 246, 255, 0.96));
          box-shadow: 0 16px 28px rgba(14, 165, 233, 0.08);
        }

        html[data-theme="light"] .control-card[data-card-tone="completed"] {
          border-color: rgba(16, 185, 129, 0.24);
          background:
            linear-gradient(180deg, rgba(236, 253, 245, 0.98), rgba(226, 250, 239, 0.96));
          box-shadow: 0 16px 28px rgba(16, 185, 129, 0.08);
        }

        html[data-theme="light"] .control-card[data-card-tone="failed"] {
          border-color: rgba(244, 63, 94, 0.2);
          background:
            linear-gradient(180deg, rgba(255, 241, 242, 0.98), rgba(255, 228, 230, 0.96));
        }

        html[data-theme="light"] .control-card[data-card-tone="ready"] .control-label {
          color: #2563eb;
        }

        html[data-theme="light"] .control-card[data-card-tone="running"] .control-label {
          color: #0f766e;
        }

        html[data-theme="light"] .control-card[data-card-tone="completed"] .control-label {
          color: #047857;
        }

        html[data-theme="light"] .control-card[data-card-tone="failed"] .control-label {
          color: #be123c;
        }

        html[data-theme="light"] .control-card[data-card-tone="ready"] .control-value {
          color: #1d4ed8;
        }

        html[data-theme="light"] .control-card[data-card-tone="running"] .control-value {
          color: #0f766e;
        }

        html[data-theme="light"] .control-card[data-card-tone="completed"] .control-value {
          color: #065f46;
        }

        html[data-theme="light"] .control-card[data-card-tone="failed"] .control-value {
          color: #9f1239;
        }

        html[data-theme="light"] .overview-card {
          background:
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 12rem),
            radial-gradient(circle at bottom left, rgba(20, 184, 166, 0.08), transparent 18rem),
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(242, 248, 255, 0.94));
        }

        html[data-theme="light"] input,
        html[data-theme="light"] textarea,
        html[data-theme="light"] select,
        html[data-theme="light"] .evidence-value,
        html[data-theme="light"] .evidence-quote,
        html[data-theme="light"] .detail-quote {
          background: rgba(255, 255, 255, 0.96);
          color: var(--ink-strong);
          border-color: rgba(148, 163, 184, 0.22);
        }

        html[data-theme="light"] .detail-scrim {
          background: rgba(15, 23, 42, 0.18);
        }

        html[data-theme="light"] .secondary,
        html[data-theme="light"] .copy-button,
        html[data-theme="light"] .detail-action-button,
        html[data-theme="light"] .status-chip,
        html[data-theme="light"] .source-drawer-toggle,
        html[data-theme="light"] .trial-link-card,
        html[data-theme="light"] .meta-pill,
        html[data-theme="light"] .entity-chip {
          background: rgba(14, 165, 233, 0.08);
          color: var(--accent);
          border-color: rgba(14, 165, 233, 0.16);
        }

        html[data-theme="light"] .arc-mark {
          background: linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(20, 184, 166, 0.1));
          border-color: rgba(14, 165, 233, 0.14);
        }

        html[data-theme="light"] .status-chip-icon {
          background: rgba(14, 165, 233, 0.08);
          border-color: rgba(14, 165, 233, 0.16);
        }

        html[data-theme="light"] .status-chip-progress {
          background: rgba(59, 130, 246, 0.12);
        }

        html[data-theme="light"] .status-chip[data-status-tone="completed"] {
          border-color: rgba(16, 185, 129, 0.26);
          color: #047857;
        }

        html[data-theme="light"] .status-chip[data-status-tone="failed"] {
          background: rgba(244, 63, 94, 0.08);
          color: #be123c;
          border-color: rgba(244, 63, 94, 0.16);
        }

        html[data-theme="light"] .status-chip[data-status-tone="completed"] .status-chip-label {
          color: #065f46;
        }

        html[data-theme="light"] .status-chip[data-status-tone="failed"] .status-chip-label {
          color: #9f1239;
        }

        html[data-theme="light"] .stage-card[data-status="running"] {
          background: linear-gradient(180deg, rgba(240, 249, 255, 0.96), rgba(230, 247, 255, 0.94));
          box-shadow: 0 16px 28px rgba(14, 165, 233, 0.08);
        }

        html[data-theme="light"] .signal-sidebar .sidebar-card {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(242, 248, 255, 0.92));
        }

        html[data-theme="light"] .graph-list ul,
        html[data-theme="light"] .muted,
        html[data-theme="light"] .mode-note,
        html[data-theme="light"] .source-note,
        html[data-theme="light"] .judgment-card p,
        html[data-theme="light"] .sidebar-card p,
        html[data-theme="light"] .evidence-card p,
        html[data-theme="light"] .overview-card p,
        html[data-theme="light"] .deep-reading-card p,
        html[data-theme="light"] .detail-copy {
          color: var(--muted);
        }

        .eyebrow {
          display: inline-flex;
          gap: 10px;
          font-size: 12px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .layout {
          display: grid;
          grid-template-columns: minmax(320px, 0.84fr) minmax(0, 2fr);
          gap: 20px;
          align-items: start;
        }

        .input-panel {
          order: 0;
          position: sticky;
          top: 24px;
        }

        .result-panel {
          order: 1;
          min-width: 0;
        }

        .panel {
          padding: 22px;
        }

        .input-grid {
          display: grid;
          gap: 14px;
        }

        .section-heading {
          display: grid;
          gap: 4px;
        }

        .section-heading h3 {
          margin: 0;
        }

        label {
          display: grid;
          gap: 8px;
          font-size: 14px;
          color: var(--muted);
        }

        input, textarea, select, button {
          font: inherit;
        }

        input, textarea, select {
          width: 100%;
          padding: 14px 16px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(7, 14, 24, 0.9);
          color: var(--ink);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }

        textarea {
          min-height: 240px;
          resize: vertical;
          line-height: 1.7;
        }

        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        button {
          border: 1px solid transparent;
          border-radius: 999px;
          padding: 13px 18px;
          cursor: pointer;
          transition: transform 140ms ease, box-shadow 140ms ease;
        }

        button:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 28px rgba(8, 15, 28, 0.34);
        }

        .primary {
          background: linear-gradient(135deg, rgba(56, 189, 248, 0.94), rgba(20, 184, 166, 0.9));
          color: #02111f;
          font-weight: 700;
        }

        .secondary {
          background: rgba(14, 25, 42, 0.9);
          border-color: rgba(94, 234, 212, 0.18);
          color: var(--accent);
        }

        .mode-note {
          margin: -4px 0 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }

        .source-drawer {
          border-radius: 24px;
          border: 1px solid rgba(94, 234, 212, 0.14);
          background:
            linear-gradient(180deg, rgba(10, 19, 33, 0.9), rgba(7, 14, 24, 0.86));
          overflow: hidden;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }

        .source-drawer[open] {
          background:
            linear-gradient(180deg, rgba(11, 22, 38, 0.94), rgba(7, 14, 24, 0.9));
        }

        .source-drawer-summary {
          list-style: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 18px 20px;
          cursor: pointer;
        }

        .source-drawer-summary::-webkit-details-marker {
          display: none;
        }

        .source-drawer-copy {
          display: grid;
          gap: 4px;
        }

        .source-drawer-copy h2 {
          margin: 0;
          font-size: clamp(1.2rem, 2vw, 1.6rem);
        }

        .source-drawer-copy p {
          margin: 0;
          color: var(--muted);
          line-height: 1.6;
        }

        .source-drawer-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 148px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(94, 234, 212, 0.18);
          background: rgba(56, 189, 248, 0.1);
          color: var(--ink-strong);
          font-size: 13px;
          text-align: center;
        }

        .source-drawer-grid {
          display: grid;
          gap: 16px;
          padding: 0 20px 20px;
        }

        .preset-grid,
        .preset-launcher-grid {
          display: grid;
          gap: 12px;
          margin-top: 6px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .preset-card,
        .preset-launcher {
          border-radius: 22px;
          border: 1px solid rgba(100, 116, 139, 0.2);
          background:
            linear-gradient(180deg, rgba(12, 23, 39, 0.88), rgba(7, 14, 24, 0.82));
          padding: 16px;
          display: grid;
          gap: 10px;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }

        .preset-card:hover,
        .preset-launcher:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 36px rgba(2, 8, 23, 0.32);
          border-color: rgba(94, 234, 212, 0.26);
        }

        .preset-card h3,
        .preset-launcher h3 {
          margin: 0;
          font-size: 18px;
        }

        .card-detail-trigger {
          cursor: pointer;
        }

        .card-detail-trigger:focus-visible {
          outline: 2px solid rgba(15, 118, 110, 0.48);
          outline-offset: 2px;
        }

        .card-detail-hint {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .preset-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(165, 243, 252, 0.82);
        }

        .preset-excerpt,
        .preset-snippet {
          margin: 0;
          color: var(--muted);
          line-height: 1.6;
        }

        .preset-snippet {
          font-size: 14px;
        }

        .hidden {
          display: none !important;
        }

        .status-chip {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          min-width: 236px;
          padding: 10px 14px;
          border-radius: 22px;
          border: 1px solid rgba(94, 234, 212, 0.16);
          background:
            linear-gradient(180deg, rgba(8, 18, 30, 0.96), rgba(6, 12, 22, 0.9));
          color: var(--accent);
          font-size: 14px;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.03),
            0 16px 32px rgba(2, 8, 23, 0.18);
        }

        .status-chip[data-status-tone="ready"] {
          border-color: rgba(140, 198, 255, 0.2);
          color: var(--accent-strong);
        }

        .status-chip[data-status-tone="running"] {
          border-color: rgba(94, 234, 212, 0.34);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 20px 38px rgba(5, 150, 105, 0.16);
        }

        .status-chip[data-status-tone="completed"] {
          border-color: rgba(52, 211, 153, 0.32);
          color: #a7f3d0;
        }

        .status-chip[data-status-tone="failed"] {
          border-color: rgba(251, 113, 133, 0.22);
          background:
            linear-gradient(180deg, rgba(43, 11, 18, 0.94), rgba(24, 7, 12, 0.9));
          color: var(--danger);
        }

        .status-chip-icon {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          flex: 0 0 auto;
          position: relative;
          background: rgba(94, 234, 212, 0.12);
          border: 1px solid rgba(94, 234, 212, 0.2);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .status-chip-icon::before,
        .status-chip-icon::after {
          content: "";
          position: absolute;
        }

        .status-chip-icon[data-status-icon="idle"]::before {
          inset: 10px;
          border-radius: 999px;
          border: 2px solid currentColor;
          opacity: 0.52;
        }

        .status-chip-icon[data-status-icon="ready"]::before {
          left: 9px;
          top: 8px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 0 6px rgba(140, 198, 255, 0.12);
        }

        .status-chip-icon[data-status-icon="running"]::before {
          inset: 7px;
          border-radius: 50%;
          border: 2px solid rgba(134, 231, 212, 0.22);
          border-top-color: currentColor;
          animation: status-spin 1s linear infinite;
        }

        .status-chip-icon[data-status-icon="running"]::after {
          inset: 12px;
          border-radius: 50%;
          background: currentColor;
          animation: status-pulse 1.2s ease-in-out infinite;
        }

        .status-chip-icon[data-status-icon="completed"]::before {
          left: 9px;
          top: 9px;
          width: 15px;
          height: 9px;
          border-left: 3px solid currentColor;
          border-bottom: 3px solid currentColor;
          transform: rotate(-45deg);
        }

        .status-chip-icon[data-status-icon="failed"]::before,
        .status-chip-icon[data-status-icon="failed"]::after {
          left: 15px;
          top: 8px;
          width: 3px;
          height: 16px;
          border-radius: 999px;
          background: currentColor;
        }

        .status-chip-icon[data-status-icon="failed"]::before {
          transform: rotate(45deg);
        }

        .status-chip-icon[data-status-icon="failed"]::after {
          transform: rotate(-45deg);
        }

        .status-chip-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .status-chip-label {
          color: var(--ink-strong);
          font-size: 14px;
          line-height: 1.1;
        }

        .status-chip[data-status-tone="completed"] .status-chip-label {
          color: #d1fae5;
        }

        .status-chip[data-status-tone="failed"] .status-chip-label {
          color: #ffe4e6;
        }

        .status-chip-meta {
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .status-chip-progress {
          margin-left: auto;
          width: 84px;
          height: 8px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(148, 163, 184, 0.14);
          position: relative;
          flex: 0 0 auto;
        }

        .status-chip-progress-fill {
          display: block;
          height: 100%;
          width: 0;
          border-radius: inherit;
          background: linear-gradient(90deg, rgba(56, 189, 248, 0.94), rgba(94, 234, 212, 0.94));
          transition: width 240ms ease;
        }

        .status-chip[data-status-tone="running"] .status-chip-progress-fill {
          background:
            linear-gradient(90deg, rgba(56, 189, 248, 0.94), rgba(94, 234, 212, 0.94), rgba(56, 189, 248, 0.94));
          background-size: 200% 100%;
          animation: status-shimmer 1.6s linear infinite;
        }

        .status-chip[data-status-tone="completed"] .status-chip-progress-fill {
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.96), rgba(110, 231, 183, 0.96));
        }

        .status-chip[data-status-tone="failed"] .status-chip-progress-fill {
          background: linear-gradient(90deg, rgba(251, 113, 133, 0.94), rgba(244, 63, 94, 0.94));
        }

        @keyframes status-spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        @keyframes status-pulse {
          0%, 100% {
            transform: scale(0.88);
            opacity: 0.78;
          }

          50% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes status-shimmer {
          from {
            background-position: 200% 0;
          }

          to {
            background-position: -200% 0;
          }
        }

        .stage-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .stage-card, .evidence-card {
          border-radius: 22px;
          border: 1px solid var(--line);
          background: rgba(9, 18, 31, 0.86);
          padding: 16px;
        }

        .stage-card[data-status="running"] {
          border-color: rgba(94, 234, 212, 0.36);
          background: linear-gradient(180deg, rgba(12, 28, 42, 0.92), rgba(8, 16, 28, 0.9));
          box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.08), 0 18px 28px rgba(8, 15, 28, 0.24);
        }

        .stage-card[data-status="completed"] {
          border-color: rgba(34, 197, 94, 0.22);
        }

        .stage-card[data-status="failed"] {
          border-color: rgba(251, 113, 133, 0.24);
          background: rgba(43, 11, 18, 0.82);
        }

        .stage-label {
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(125, 211, 252, 0.82);
        }

        .stage-status {
          margin-top: 8px;
          font-size: 20px;
          color: var(--ink-strong);
        }

        .evidence-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .graph-preview,
        .graph-surface {
          margin-top: 18px;
          border-radius: 22px;
          border: 1px solid rgba(134, 231, 212, 0.16);
          background:
            radial-gradient(circle at 16% 18%, rgba(140, 198, 255, 0.16), transparent 10rem),
            radial-gradient(circle at 84% 12%, rgba(134, 231, 212, 0.14), transparent 10rem),
            linear-gradient(180deg, rgba(7, 13, 24, 0.94), rgba(5, 9, 18, 0.92));
          min-height: 260px;
          padding: 18px;
          position: relative;
          overflow: hidden;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 18px 34px rgba(2, 8, 23, 0.22);
        }

        .graph-preview::before,
        .graph-surface::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: radial-gradient(circle at center, black, transparent 92%);
        }

        .graph-preview > *,
        .graph-surface > * {
          position: relative;
          z-index: 1;
        }

        .graph-preview svg,
        .graph-surface svg {
          width: 100%;
          height: auto;
          display: block;
        }

        .graph-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .graph-preview-meta {
          display: grid;
          gap: 4px;
        }

        .graph-preview-note {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
        }

        .graph-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
          margin-left: auto;
        }

        .graph-expand-button {
          white-space: nowrap;
        }

        .graph-zoom-button {
          min-width: 42px;
          padding: 10px 12px;
          font-size: 13px;
        }

        .graph-zoom-label {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 62px;
          padding: 9px 12px;
          border-radius: 999px;
          border: 1px solid rgba(140, 198, 255, 0.18);
          background: rgba(5, 11, 20, 0.82);
          color: var(--ink-strong);
          font-family: "SFMono-Regular", "Menlo", monospace;
          font-size: 12px;
          letter-spacing: 0.06em;
        }

        .graph-canvas {
          width: 100%;
          min-height: 340px;
        }

        .graph-modal-shell {
          position: fixed;
          inset: 0;
          z-index: 24;
        }

        .graph-modal-panel {
          position: absolute;
          inset: max(20px, 4vh) max(20px, 4vw);
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 16px;
          border-radius: 28px;
          border: 1px solid rgba(94, 234, 212, 0.16);
          background:
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 14rem),
            linear-gradient(180deg, rgba(9, 18, 31, 0.98), rgba(4, 9, 17, 0.98));
          box-shadow: 0 24px 64px rgba(2, 8, 23, 0.48);
          padding: 22px;
        }

        .graph-modal-frame {
          width: 100%;
          min-height: min(72vh, 820px);
          border: 0;
          border-radius: 22px;
          background: transparent;
        }

        .graph-modal-canvas {
          width: 100%;
          min-height: min(72vh, 820px);
        }

        .graph-list {
          display: grid;
          gap: 12px;
        }

        .graph-list.zoomable {
          min-height: min(72vh, 820px);
          align-content: start;
        }

        .graph-list-body {
          display: grid;
          gap: 14px;
        }

        .graph-list.zoomable .graph-list-body {
          --graph-list-zoom: 1;
          transform: scale(var(--graph-list-zoom));
          transform-origin: top left;
          width: calc(100% / var(--graph-list-zoom));
          transition: transform 180ms ease;
        }

        .graph-list.zoomable .entity-chip {
          font-size: calc(13px * var(--graph-list-zoom));
          padding: calc(8px * var(--graph-list-zoom)) calc(12px * var(--graph-list-zoom));
          margin: 0 calc(8px * var(--graph-list-zoom)) calc(8px * var(--graph-list-zoom)) 0;
        }

        .graph-list ul {
          margin: 0;
          padding-left: 18px;
          color: var(--muted);
        }

        .graph-list.zoomable ul {
          padding-left: calc(18px * var(--graph-list-zoom));
          font-size: calc(15px * var(--graph-list-zoom));
        }

        .muted {
          color: var(--muted);
        }

        .error {
          color: var(--danger);
        }

        pre {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: "SFMono-Regular", "Menlo", monospace;
          font-size: 13px;
        }

        .evidence-list {
          display: grid;
          gap: 12px;
        }

        .evidence-item {
          border-radius: 18px;
          border: 1px solid rgba(100, 116, 139, 0.18);
          background: rgba(8, 17, 29, 0.82);
          padding: 14px;
        }

        .evidence-item h3 {
          margin: 0 0 12px;
          font-size: 16px;
          text-transform: capitalize;
        }

        .evidence-field {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
        }

        .evidence-field:last-child {
          margin-bottom: 0;
        }

        .evidence-label {
          grid-column: 1 / -1;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--gold);
        }

        .evidence-value {
          min-width: 0;
          padding: 8px 10px;
          border-radius: 12px;
          background: rgba(3, 10, 20, 0.82);
          border: 1px solid rgba(100, 116, 139, 0.18);
          font-family: "SFMono-Regular", "Menlo", monospace;
          font-size: 12px;
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .copy-button {
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(94, 234, 212, 0.2);
          background: rgba(56, 189, 248, 0.1);
          color: var(--ink-strong);
          font-size: 13px;
        }

        .copy-button:disabled {
          opacity: 0.7;
          cursor: default;
        }

        .workbench-top {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }

        .workbench-top h2 {
          margin: 0 0 6px;
          font-size: clamp(1.4rem, 3vw, 2.1rem);
        }

        .sidebar-heading {
          margin-bottom: -2px;
        }

        .workbench-top p {
          margin: 0;
          color: var(--muted);
          line-height: 1.45;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 8px;
        }

        .arc-mark {
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(94, 234, 212, 0.14);
        }

        .arc-mark img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .arc-brand {
          display: grid;
          gap: 2px;
        }

        .arc-wordmark {
          font-size: 1.15rem;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: var(--ink-strong);
        }

        .arc-subtitle {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .control-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .theme-toggle {
          width: 48px;
          height: 48px;
          min-width: 48px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          position: relative;
        }

        .theme-toggle-glyph {
          width: 22px;
          height: 22px;
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .theme-toggle-core,
        .theme-toggle-halo {
          position: absolute;
          inset: 0;
          border-radius: 999px;
        }

        .theme-toggle-core {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(148, 163, 184, 0.72));
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        .theme-toggle-core::after {
          content: "";
          position: absolute;
          border-radius: 999px;
        }

        .theme-toggle-halo::before,
        .theme-toggle-halo::after {
          content: "";
          position: absolute;
        }

        .theme-toggle[data-theme-icon="moon"] .theme-toggle-core::after {
          width: 16px;
          height: 16px;
          top: -1px;
          left: 8px;
          background: rgba(14, 25, 42, 0.94);
        }

        .theme-toggle[data-theme-icon="moon"] .theme-toggle-halo {
          opacity: 0;
        }

        .theme-toggle[data-theme-icon="sun"] .theme-toggle-core {
          background: linear-gradient(135deg, rgba(253, 230, 138, 0.98), rgba(251, 191, 36, 0.9));
        }

        .theme-toggle[data-theme-icon="sun"] .theme-toggle-core::after {
          inset: 4px;
          background: rgba(253, 230, 138, 0.98);
          box-shadow: 0 0 16px rgba(251, 191, 36, 0.34);
        }

        .theme-toggle[data-theme-icon="sun"] .theme-toggle-halo::before,
        .theme-toggle[data-theme-icon="sun"] .theme-toggle-halo::after {
          inset: -5px;
          border-radius: 999px;
          border: 1px solid rgba(251, 191, 36, 0.34);
        }

        .theme-toggle[data-theme-icon="sun"] .theme-toggle-halo::before {
          transform: scale(1.12);
        }

        .theme-toggle[data-theme-icon="sun"] .theme-toggle-halo::after {
          transform: scale(1.36);
          opacity: 0.64;
        }

        .trial-link-section {
          display: grid;
          gap: 10px;
        }

        .trial-link-grid {
          display: grid;
          gap: 10px;
        }

        .trial-link-card {
          display: grid;
          gap: 8px;
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid rgba(94, 234, 212, 0.16);
          background: rgba(7, 14, 24, 0.82);
          color: var(--ink-strong);
          text-decoration: none;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }

        .control-stepper {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          align-items: start;
        }

        .control-step {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .control-step-marker {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .control-step-dot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          flex: 0 0 auto;
          border: 2px solid rgba(148, 163, 184, 0.4);
          background: rgba(8, 18, 30, 0.6);
          position: relative;
        }

        .control-step-line {
          height: 2px;
          flex: 1 1 auto;
          margin-left: 8px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.18);
          overflow: hidden;
        }

        .control-step-line::after {
          content: "";
          display: block;
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, rgba(56, 189, 248, 0.92), rgba(94, 234, 212, 0.92));
          transition: width 220ms ease;
        }

        .control-step[data-stage-status="completed"] .control-step-dot {
          border-color: rgba(52, 211, 153, 0.44);
          background: rgba(16, 185, 129, 0.94);
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .control-step[data-stage-status="completed"] .control-step-dot::after {
          content: "";
          position: absolute;
          left: 2px;
          top: 1px;
          width: 3px;
          height: 5px;
          border-right: 2px solid #032015;
          border-bottom: 2px solid #032015;
          transform: rotate(45deg);
        }

        .control-step[data-stage-status="completed"] .control-step-line::after {
          width: 100%;
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.94), rgba(94, 234, 212, 0.9));
        }

        .control-step[data-stage-status="running"] .control-step-dot {
          border-color: rgba(94, 234, 212, 0.48);
          background: rgba(56, 189, 248, 0.94);
          box-shadow: 0 0 0 5px rgba(56, 189, 248, 0.12);
          animation: control-step-pulse 1.25s ease-in-out infinite;
        }

        .control-step[data-stage-status="running"] .control-step-line::after {
          width: 58%;
          background:
            linear-gradient(90deg, rgba(56, 189, 248, 0.94), rgba(94, 234, 212, 0.94), rgba(56, 189, 248, 0.94));
          background-size: 200% 100%;
          animation: status-shimmer 1.6s linear infinite;
        }

        .control-step[data-stage-status="failed"] .control-step-dot {
          border-color: rgba(251, 113, 133, 0.48);
          background: rgba(244, 63, 94, 0.94);
          box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.12);
        }

        .control-step[data-stage-status="failed"] .control-step-dot::before,
        .control-step[data-stage-status="failed"] .control-step-dot::after {
          content: "";
          position: absolute;
          left: 3px;
          top: 0;
          width: 2px;
          height: 8px;
          border-radius: 999px;
          background: #2a0a10;
        }

        .control-step[data-stage-status="failed"] .control-step-dot::before {
          transform: rotate(45deg);
        }

        .control-step[data-stage-status="failed"] .control-step-dot::after {
          transform: rotate(-45deg);
        }

        .control-step-name {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.88);
          line-height: 1.4;
        }

        .control-step[data-stage-status="running"] .control-step-name,
        .control-step[data-stage-status="completed"] .control-step-name {
          color: var(--ink-strong);
        }

        .control-step[data-stage-status="failed"] .control-step-name {
          color: #ffe4e6;
        }

        @keyframes control-step-pulse {
          0%, 100% {
            transform: scale(0.92);
          }

          50% {
            transform: scale(1);
          }
        }

        .trial-link-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 28px rgba(2, 8, 23, 0.2);
          border-color: rgba(94, 234, 212, 0.3);
        }

        .trial-link-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }

        .trial-open-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }

        .trial-link-source {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .trial-link-url {
          font-size: 12px;
          color: var(--muted);
          word-break: break-all;
        }

        .workbench-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.68fr) minmax(320px, 0.74fr);
          gap: 20px;
        }

        .workbench-main,
        .workbench-sidebar {
          display: grid;
          gap: 16px;
        }

        .main-reading-rail {
          gap: 20px;
        }

        .workbench-sidebar {
          align-content: start;
        }

        .overview-card,
        .sidebar-card,
        .judgment-card,
        .evidence-card {
          border-radius: 24px;
          border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(10, 19, 33, 0.9), rgba(7, 14, 24, 0.86));
          padding: 20px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 18px 36px rgba(2, 8, 23, 0.26);
        }

        .overview-card {
          background:
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 12rem),
            radial-gradient(circle at bottom left, rgba(14, 116, 144, 0.12), transparent 18rem),
            linear-gradient(180deg, rgba(10, 22, 38, 0.98), rgba(6, 13, 24, 0.92));
          border-color: rgba(94, 234, 212, 0.18);
          padding: 24px;
        }

        .overview-card::before,
        .sidebar-card::before,
        .judgment-card::before,
        .evidence-card::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, rgba(56, 189, 248, 0.8), rgba(94, 234, 212, 0.7), transparent);
        }

        .section-kicker {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(125, 211, 252, 0.88);
          margin-bottom: 10px;
        }

        .overview-card h3 {
          margin: 0 0 10px;
          font-size: clamp(1.72rem, 3vw, 2.68rem);
          line-height: 1.02;
          letter-spacing: -0.04em;
          color: var(--ink-strong);
        }

        .overview-card p {
          margin: 0;
          color: var(--muted);
          font-size: 16px;
          line-height: 1.82;
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
          gap: 10px;
          margin-top: 16px;
        }

        .metric-tile {
          border-radius: 18px;
          padding: 14px;
          border: 1px solid rgba(94, 234, 212, 0.12);
          background: rgba(6, 13, 24, 0.82);
        }

        .metric-label {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(125, 211, 252, 0.78);
          margin-bottom: 8px;
        }

        .metric-value {
          font-size: 20px;
          line-height: 1.2;
          color: var(--ink-strong);
        }

        .judgment-grid {
          display: grid;
          gap: 12px;
        }

        .judgment-card h3,
        .sidebar-card h3,
        .evidence-card h3 {
          margin: 0 0 10px;
          font-size: 18px;
        }

        .judgment-card {
          background:
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 12rem),
            linear-gradient(180deg, rgba(10, 19, 33, 0.94), rgba(8, 16, 28, 0.9));
        }

        .judgment-card p,
        .sidebar-card p,
        .evidence-card p {
          margin: 0;
          color: var(--muted);
          font-size: 16px;
          line-height: 1.72;
        }

        .judgment-card h3,
        .sidebar-card h3,
        .evidence-card h3 {
          color: var(--ink-strong);
        }

        .judgment-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }

        .meta-pill {
          display: inline-flex;
          align-items: center;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.12);
          color: var(--accent);
          font-size: 12px;
        }

        .evidence-quote {
          margin-top: 12px;
          padding: 14px;
          border-radius: 18px;
          background: rgba(3, 10, 20, 0.82);
          border: 1px solid rgba(100, 116, 139, 0.18);
          color: var(--ink);
          line-height: 1.7;
        }

        .sidebar-card .stage-grid {
          grid-template-columns: 1fr;
          margin-top: 0;
        }

        .sidebar-stack,
        .entity-list,
        .credential-list,
        .source-list {
          display: grid;
          gap: 10px;
        }

        .entity-chip {
          display: inline-flex;
          align-items: center;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.1);
          color: var(--ink-strong);
          font-size: 13px;
          margin: 0 8px 8px 0;
        }

        .source-note {
          font-size: 14px;
          color: var(--muted);
          line-height: 1.7;
        }

        .deep-reading-section {
          display: grid;
          gap: 12px;
        }

        .deep-reading-card {
          border-radius: 24px;
          border: 1px solid var(--line);
          background:
            linear-gradient(180deg, rgba(10, 19, 33, 0.92), rgba(7, 14, 24, 0.9));
          padding: 20px;
          box-shadow: 0 18px 36px rgba(2, 8, 23, 0.24);
        }

        .deep-reading-card p {
          margin: 0;
          color: rgba(226, 232, 240, 0.92);
          font-size: 16px;
          line-height: 1.82;
          white-space: pre-wrap;
        }

        .deep-reading-blocks {
          display: grid;
          gap: 14px;
          margin-top: 16px;
        }

        .deep-reading-block {
          display: grid;
          gap: 8px;
          padding-top: 14px;
          border-top: 1px solid rgba(100, 116, 139, 0.16);
        }

        .deep-reading-block:first-child {
          padding-top: 0;
          border-top: none;
        }

        .deep-reading-block h4 {
          margin: 0;
          font-size: 14px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(125, 211, 252, 0.8);
        }

        .deep-reading-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }

        .credential-list .evidence-item {
          background: rgba(5, 12, 22, 0.84);
        }

        .meta-section {
          display: grid;
          gap: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(100, 116, 139, 0.16);
        }

        .meta-section:first-child {
          padding-top: 0;
          border-top: none;
        }

        .meta-section h3 {
          margin: 0;
          font-size: 15px;
        }

        .detail-shell,
        .detail-drawer {
          position: fixed;
          inset: 0;
          z-index: 20;
        }

        .detail-scrim {
          position: absolute;
          inset: 0;
          background: rgba(2, 8, 23, 0.62);
          backdrop-filter: blur(12px);
        }

        .detail-panel {
          position: absolute;
          top: 0;
          right: 0;
          width: min(480px, 42vw);
          height: 100vh;
          overflow: auto;
          border-left: 1px solid rgba(94, 234, 212, 0.16);
          background:
            radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 12rem),
            linear-gradient(180deg, rgba(9, 18, 31, 0.98), rgba(4, 9, 17, 0.98));
          box-shadow: -16px 0 48px rgba(2, 8, 23, 0.44);
          padding: 22px;
        }

        .detail-panel-top {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }

        .detail-panel-top h2 {
          margin: 0;
          font-size: clamp(1.5rem, 3vw, 2rem);
          color: var(--ink-strong);
        }

        .detail-panel-body {
          display: grid;
          gap: 14px;
          margin-top: 18px;
        }

        .detail-section {
          display: grid;
          gap: 10px;
          border-radius: 22px;
          border: 1px solid rgba(100, 116, 139, 0.18);
          background: rgba(8, 17, 29, 0.84);
          padding: 16px;
        }

        .detail-section h3 {
          margin: 0;
          font-size: 15px;
        }

        .detail-copy {
          margin: 0;
          font-size: 16px;
          line-height: 1.78;
          color: var(--muted);
          white-space: pre-wrap;
        }

        .detail-quote {
          margin: 0;
          padding: 16px 18px;
          border-radius: 18px;
          border: 1px solid rgba(100, 116, 139, 0.18);
          background: rgba(3, 10, 20, 0.84);
          color: var(--ink);
          font-size: 16px;
          line-height: 1.82;
          white-space: pre-wrap;
        }

        .detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .detail-meta-list {
          display: grid;
          gap: 10px;
        }

        .detail-meta-row {
          display: grid;
          gap: 6px;
        }

        .detail-meta-row strong,
        .detail-context-card strong {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(125, 211, 252, 0.8);
        }

        .detail-context-grid {
          display: grid;
          gap: 10px;
        }

        .detail-context-card {
          display: grid;
          gap: 6px;
          border-radius: 18px;
          border: 1px solid rgba(100, 116, 139, 0.18);
          background: rgba(5, 12, 22, 0.84);
          padding: 14px;
        }

        .detail-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .detail-action-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid rgba(94, 234, 212, 0.22);
          background: rgba(56, 189, 248, 0.1);
          color: var(--ink-strong);
          text-decoration: none;
          cursor: pointer;
        }

        .hero,
        .overview-card,
        .judgment-card,
        .sidebar-card,
        .evidence-card,
        .preset-card {
          animation: rise-in 420ms ease both;
        }

        .workbench-main > *:nth-child(2) { animation-delay: 60ms; }
        .workbench-main > *:nth-child(3) { animation-delay: 120ms; }
        .workbench-sidebar > *:nth-child(2) { animation-delay: 80ms; }
        .workbench-sidebar > *:nth-child(3) { animation-delay: 120ms; }
        .workbench-sidebar > *:nth-child(4) { animation-delay: 160ms; }
        .workbench-sidebar > *:nth-child(5) { animation-delay: 200ms; }

        @keyframes rise-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 1100px) {
          .control-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .control-stepper {
            grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
          }

          .control-card-wide {
            grid-column: span 2;
          }

          .preset-grid,
          .judgment-grid,
          .evidence-list,
          .workbench-sidebar {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 940px) {
          .layout {
            grid-template-columns: 1fr;
          }

          .control-stepper {
            grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
          }

          .control-grid {
            grid-template-columns: 1fr;
          }

          .control-card-wide {
            grid-column: span 1;
          }

          .workbench-grid {
            grid-template-columns: 1fr;
          }

          .input-panel {
            position: static;
            order: 1;
          }

          .result-panel {
            order: 2;
          }

          textarea {
            min-height: 180px;
          }
        }

        @media (max-width: 720px) {
          main {
            padding: 12px 12px 36px;
          }

          .control-strip,
          .toolbelt-shell,
          .panel {
            border-radius: 22px;
            padding: 16px;
          }

          .control-strip {
            margin-bottom: 12px;
          }

          .control-strip h1 {
            font-size: 2.15rem;
            line-height: 1;
          }

          .brand-row {
            gap: 10px;
            margin-bottom: 6px;
          }

          .arc-mark {
            width: 42px;
            height: 42px;
            border-radius: 14px;
          }

          .arc-subtitle {
            font-size: 11px;
          }

          .workbench-top {
            gap: 10px;
            margin-bottom: 10px;
          }

          .control-actions {
            width: 100%;
            justify-content: space-between;
          }

          .status-chip {
            flex: 1 1 auto;
            min-width: 0;
          }

          .control-stepper {
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 6px;
          }

          .control-step-name {
            font-size: 10px;
            line-height: 1.25;
          }

          .control-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
            margin-top: 12px;
          }

          #control-card-source-status,
          #control-card-run-status,
          #control-card-credential-status {
            display: none;
          }

          .control-card,
          .control-card-wide {
            min-height: 82px;
          }

          .control-card-wide {
            grid-column: span 1;
          }

          .control-label {
            margin-bottom: 7px;
          }

          .control-value {
            font-size: 15px;
          }

          .layout,
          .workbench-grid,
          .workbench-main,
          .workbench-sidebar {
            gap: 12px;
          }

          .source-drawer-summary {
            padding: 16px;
          }

          .source-drawer-copy h2 {
            font-size: 1.35rem;
          }

          .source-drawer-copy p {
            display: none;
          }

          .source-drawer-toggle {
            min-width: 116px;
            padding: 9px 12px;
          }

          .overview-card {
            border-radius: 22px;
            padding: 18px;
          }

          .overview-card h3 {
            font-size: 1.9rem;
            line-height: 1.06;
          }

          .overview-card p {
            font-size: 15px;
            line-height: 1.68;
          }

          .metric-grid {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .metric-tile {
            padding: 12px 14px;
          }

          .metric-value {
            font-size: 18px;
          }

          .detail-panel {
            left: 0;
            width: 100%;
            max-width: none;
            border-left: none;
            box-shadow: none;
            padding-bottom: 28px;
          }

          .graph-modal-panel {
            inset: 0;
            border-radius: 0;
            border: none;
            box-shadow: none;
          }

          .graph-modal-canvas {
            min-height: 58vh;
          }
        }
      </style>
    </head>
    <body>
      <main class="command-center">
        <section class="panel control-strip toolbelt-shell command-deck">
          <div class="section-kicker">决策总览</div>
          <div class="workbench-top">
            <div>
              <div class="brand-row">
                <div class="arc-mark" aria-hidden="true">
                  <img src="${LIVE_BRAND_LOGO_URL}" alt="" />
                </div>
                <div class="arc-brand">
                  <span class="arc-wordmark">Arc</span>
                  <span class="arc-subtitle">The Economic OS</span>
                </div>
              </div>
              <h1>Arc Signal Desk</h1>
              <p id="control-summary">状态卡和执行轨迹会随当前分析自动更新。</p>
              <p id="control-phase" class="mode-note">阶段：尚未进入分析阶段</p>
              <div id="control-stepper" class="control-stepper" aria-label="分析阶段">
                <div id="control-step-create" class="control-step" data-stage-key="create" data-stage-status="pending">
                  <div class="control-step-marker">
                    <span class="control-step-dot" aria-hidden="true"></span>
                    <span class="control-step-line" aria-hidden="true"></span>
                  </div>
                  <span class="control-step-name">创建会话</span>
                </div>
                <div id="control-step-summary" class="control-step" data-stage-key="summary" data-stage-status="pending">
                  <div class="control-step-marker">
                    <span class="control-step-dot" aria-hidden="true"></span>
                    <span class="control-step-line" aria-hidden="true"></span>
                  </div>
                  <span class="control-step-name">事件判断</span>
                </div>
                <div id="control-step-entities" class="control-step" data-stage-key="entities" data-stage-status="pending">
                  <div class="control-step-marker">
                    <span class="control-step-dot" aria-hidden="true"></span>
                    <span class="control-step-line" aria-hidden="true"></span>
                  </div>
                  <span class="control-step-name">主体抽取</span>
                </div>
                <div id="control-step-relations" class="control-step" data-stage-key="relations" data-stage-status="pending">
                  <div class="control-step-marker">
                    <span class="control-step-dot" aria-hidden="true"></span>
                    <span class="control-step-line" aria-hidden="true"></span>
                  </div>
                  <span class="control-step-name">关系整理</span>
                </div>
                <div id="control-step-graph" class="control-step" data-stage-key="graph" data-stage-status="pending">
                  <div class="control-step-marker">
                    <span class="control-step-dot" aria-hidden="true"></span>
                  </div>
                  <span class="control-step-name">结果归档</span>
                </div>
              </div>
            </div>
            <div class="control-actions">
              <button
                id="theme-toggle"
                class="secondary theme-toggle"
                type="button"
                aria-label="切换到夜航"
                title="切换到夜航"
                data-theme-icon="moon"
              >
                <span class="theme-toggle-glyph" aria-hidden="true">
                  <span class="theme-toggle-core"></span>
                  <span class="theme-toggle-halo"></span>
                </span>
              </button>
              <div id="overall-status" class="status-chip" data-status-tone="idle" aria-live="polite">
                <span id="overall-status-icon" class="status-chip-icon" data-status-icon="idle" aria-hidden="true"></span>
                <span class="status-chip-copy">
                  <strong id="overall-status-label" class="status-chip-label">待导入</strong>
                  <span id="overall-status-meta" class="status-chip-meta">0 / 5 阶段</span>
                </span>
                <span
                  id="overall-status-progressbar"
                  class="status-chip-progress"
                  role="progressbar"
                  aria-label="分析进度"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow="0"
                >
                  <span id="overall-status-progress" class="status-chip-progress-fill" style="width:0%"></span>
                </span>
              </div>
            </div>
          </div>
          <div class="control-grid toolbelt-actions">
            <article id="control-card-current-object" class="control-card" data-card-tone="idle">
              <div class="control-label">当前对象</div>
              <div id="control-current-object" class="control-value">等待分析开始</div>
            </article>
            <article id="control-card-source-status" class="control-card" data-card-tone="idle">
              <div class="control-label">来源状态</div>
              <div id="control-source-status" class="control-value">待导入</div>
            </article>
            <article id="control-card-run-status" class="control-card" data-card-tone="idle">
              <div class="control-label">运行状态</div>
              <div id="control-run-status" class="control-value">待导入 · 尚未进入分析阶段</div>
            </article>
            <article id="control-card-credential-status" class="control-card" data-card-tone="idle">
              <div class="control-label">凭证状态</div>
              <div id="control-credential-status" class="control-value">待生成凭证</div>
            </article>
            <article id="control-card-next-action" class="control-card control-card-wide" data-card-tone="idle">
              <div class="control-label">下一步动作</div>
              <div id="control-next-action" class="control-value">导入材料</div>
              <p id="control-next-action-hint" class="mode-note">从线索入口开始一次新分析。</p>
            </article>
          </div>
        </section>

        <section class="layout">
          <article class="panel input-panel">
            <details id="source-drawer" class="source-drawer">
              <summary class="source-drawer-summary" data-testid="source-drawer-toggle">
                <div class="source-drawer-copy">
                  <div class="section-kicker">线索入口</div>
                  <h2>线索入口</h2>
                  <p>选一条预置线索最快进入演示；也可以粘贴新闻链接或手动正文开始分析。</p>
                </div>
                <span class="source-drawer-toggle">展开启动入口</span>
              </summary>
              <div class="source-drawer-grid input-grid">
                <label>
                  输入模式
                  <select id="input-mode-input">
                    <option value="link">文章链接</option>
                    <option value="manual" selected>手动文本</option>
                  </select>
                </label>
                <p class="mode-note">默认使用手动正文输入。支持站点：${escapeHtml(Object.values(SUPPORTED_NEWS_SOURCE_LABELS).join(' / '))}。手动模式下系统会基于正文自动生成展示标题；链接模式会提交到 ${LIVE_PRODUCT_BASE_PATH}/session 并先执行导入。</p>

                <label id="article-url-field">
                  文章链接
                  <input id="article-url-input" placeholder="粘贴资讯原文链接" />
                </label>

                <div id="manual-fields">
                  <div class="input-grid">
                    <label>
                      Source Type
                      <select id="source-type-input">
                        <option value="news"${sample.sourceType === 'news' ? ' selected' : ''}>news</option>
                        <option value="research"${sample.sourceType === 'research' ? ' selected' : ''}>research</option>
                      </select>
                    </label>
                    <label>
                      文本
                      <textarea id="text-input">${escapeHtml(sample.text)}</textarea>
                    </label>
                  </div>
                </div>

                <div class="button-row">
                  <button id="start-button" class="primary" type="button">开始分析</button>
                  <button id="fill-sample-button" class="secondary" type="button">填充示例</button>
                </div>
                <p id="form-message" class="muted">页面只会自动恢复仍在运行中的分析任务，完成或失败结果不会默认回显。</p>

                <section class="section-heading">
                  <h3>预置资讯启动器</h3>
                  <p class="muted">动态优先加载 Arc 相关资讯，失败时回退到本地预置样本。先看摘要与原始片段，再决定是否直接启动分析。</p>
                </section>
                <section class="preset-grid preset-launcher-grid">${presetCards}</section>

                <section class="trial-link-section">
                  <div class="section-heading">
                    <h3>推荐试跑链接</h3>
                    <p class="muted">这些链接已经在当前解析器上验证过，可直接粘贴到文章链接模式进行试跑。</p>
                  </div>
                  <div class="trial-link-grid">${recommendedTrialCards}</div>
                </section>
              </div>
            </details>
          </article>

          <article class="panel result-panel workbench-shell">
            <section class="workbench-grid" aria-live="polite">
              <div class="workbench-main main-reading-rail">
                <article id="overview-card" class="overview-card card-detail-trigger" tabindex="0" role="button">
                  <div class="section-kicker">执行摘要</div>
                  <div class="card-detail-hint">完整摘要</div>
                  <h3 id="event-headline">等待分析开始</h3>
                  <p id="event-summary">选择一条资讯后，系统会先生成执行摘要，再补全主体、证据和调用凭证。</p>
                  <div id="event-metrics" class="metric-grid">
                    <article class="metric-tile">
                      <div class="metric-label">事件类型</div>
                      <div class="metric-value">待识别</div>
                    </article>
                    <article class="metric-tile">
                      <div class="metric-label">重要性</div>
                      <div class="metric-value">待判断</div>
                    </article>
                    <article class="metric-tile">
                      <div class="metric-label">来源方式</div>
                      <div class="metric-value">待输入</div>
                    </article>
                    <article class="metric-tile">
                      <div class="metric-label">总成本</div>
                      <div class="metric-value">n/a</div>
                    </article>
                  </div>
                </article>

                <section>
                  <div class="section-heading">
                    <h3>核心结论</h3>
                    <p class="muted">每条结论都应回答“为什么重要”。核心结论需要证据挂钩；没有证据锚点时，结论卡会先保留为待核验提示。</p>
                  </div>
                  <div id="judgment-list" class="judgment-grid">
                    <article class="judgment-card">
                      <div class="section-kicker">核心结论</div>
                      <h3>等待事件判断生成</h3>
                      <p>summary 完成后，这里会优先出现 2-3 条可继续跟进的结论。</p>
                    </article>
                  </div>
                </section>

                <section>
                  <div class="section-heading">
                    <h3>证据锚点</h3>
                    <p class="muted">证据锚点会固定留在主区，帮助人工复核结论；暂不宣称已完成逐句证据对齐。</p>
                  </div>
                  <div id="evidence-preview" class="evidence-list muted">尚无可回看的原文证据。</div>
                </section>

                <section class="deep-reading-section">
                  <div class="section-heading">
                    <h3>深度解读</h3>
                    <p class="muted">完整摘要、延展判断与复核提示会在这里继续展开，不打断首屏的主阅读链。</p>
                  </div>
                  <article class="deep-reading-card">
                    <p id="deep-reading-copy">完整摘要、延展判断与复核提示会在首轮结果返回后继续展开。</p>
                    <div id="deep-reading-context" class="deep-reading-blocks"></div>
                    <div id="deep-reading-meta" class="deep-reading-meta"></div>
                  </article>
                </section>
              </div>

              <aside class="workbench-sidebar signal-sidebar">
                <section class="section-heading sidebar-heading">
                  <h3>信号侧栏</h3>
                </section>

                <article class="sidebar-card">
                  <div class="section-kicker">来源信息</div>
                  <div id="source-preview" class="source-list">
                    <p class="source-note">等待来源进入。</p>
                  </div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">核心主体</div>
                  <div id="entity-preview" class="entity-list muted">等待主体返回。</div>
                </article>

                <article class="sidebar-card graph-card">
                  <div class="section-kicker">关系导航</div>
                  <section id="graph-preview" class="graph-preview graph-surface" aria-live="polite">
                    <p class="muted">等待关系返回。</p>
                  </section>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">调用凭证</div>
                  <div id="credential-preview" class="credential-list muted">等待凭证回填。</div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">执行轨迹</div>
                  <div id="stage-grid" class="stage-grid"></div>
                </article>
              </aside>
            </section>
          </article>
        </section>

        <div id="detail-drawer" class="detail-shell detail-drawer hidden" aria-hidden="true">
          <div id="detail-scrim" class="detail-scrim"></div>
          <aside id="detail-panel" class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-panel-title">
            <div class="detail-panel-top">
              <div>
                <div id="detail-panel-kicker" class="section-kicker">详情</div>
                <h2 id="detail-panel-title">卡片详情</h2>
                <p id="detail-panel-subtitle" class="mode-note">右侧详情抽屉承接深度解读、证据上下文与后续动作。</p>
              </div>
              <button id="detail-panel-close" class="secondary" type="button">关闭</button>
            </div>
            <div class="detail-panel-body">
              <section id="detail-main-section" class="detail-section">
                <h3 id="detail-main-label">正文</h3>
                <p id="detail-main-copy" class="detail-copy"></p>
              </section>
              <section id="detail-quote-section" class="detail-section hidden">
                <h3 id="detail-quote-label">原始片段</h3>
                <blockquote id="detail-quote" class="detail-quote"></blockquote>
              </section>
              <section id="detail-judgment-meta-section" class="detail-section hidden">
                <h3>核心结论详情</h3>
                <div class="detail-meta-list">
                  <div class="detail-meta-row">
                    <strong>判断标签</strong>
                    <div id="detail-judgment-tags" class="detail-meta"></div>
                  </div>
                  <div class="detail-meta-row">
                    <strong>来源状态</strong>
                    <p id="detail-source-status" class="detail-copy"></p>
                  </div>
                </div>
              </section>
              <section id="detail-evidence-section" class="detail-section hidden">
                <h3>证据锚点详情</h3>
                <div class="detail-context-grid">
                  <div class="detail-context-card">
                    <strong>当前摘录</strong>
                    <p id="detail-current-quote" class="detail-copy"></p>
                  </div>
                  <div id="detail-previous-context-card" class="detail-context-card hidden">
                    <strong>前文上下文</strong>
                    <p id="detail-previous-quote" class="detail-copy"></p>
                  </div>
                  <div id="detail-next-context-card" class="detail-context-card hidden">
                    <strong>后文上下文</strong>
                    <p id="detail-next-quote" class="detail-copy"></p>
                  </div>
                </div>
                <div class="detail-meta-list">
                  <div class="detail-meta-row">
                    <strong>来源站点</strong>
                    <p id="detail-evidence-source-site" class="detail-copy"></p>
                  </div>
                  <div class="detail-meta-row">
                    <strong>导入方式</strong>
                    <p id="detail-evidence-import-mode" class="detail-copy"></p>
                  </div>
                  <div class="detail-meta-row">
                    <strong>导入状态</strong>
                    <p id="detail-evidence-import-status" class="detail-copy"></p>
                  </div>
                  <div id="detail-cached-at-row" class="detail-meta-row hidden">
                    <strong>缓存时间</strong>
                    <p id="detail-evidence-cached-at" class="detail-copy"></p>
                  </div>
                </div>
              </section>
              <section id="detail-preset-section" class="detail-section hidden">
                <h3>预置资讯卡详情</h3>
                <div class="detail-meta-list">
                  <div class="detail-meta-row">
                    <strong>标题</strong>
                    <p id="detail-preset-title" class="detail-copy"></p>
                  </div>
                  <div class="detail-meta-row">
                    <strong>来源</strong>
                    <p id="detail-preset-source" class="detail-copy"></p>
                  </div>
                  <div class="detail-meta-row">
                    <strong>启动说明</strong>
                    <p id="detail-preset-cache" class="detail-copy"></p>
                  </div>
                  <div class="detail-meta-row">
                    <strong>摘要</strong>
                    <p id="detail-preset-summary" class="detail-copy"></p>
                  </div>
                </div>
              </section>
              <div id="detail-actions" class="detail-actions"></div>
            </div>
          </aside>
        </div>

        <div id="graph-modal" class="graph-modal-shell hidden" aria-hidden="true">
          <div id="graph-modal-scrim" class="detail-scrim"></div>
          <section class="graph-modal-panel" role="dialog" aria-modal="true" aria-labelledby="graph-modal-title">
            <div class="detail-panel-top">
              <div>
                <div class="section-kicker">导航展开</div>
                <h2 id="graph-modal-title">关系导航</h2>
                <p class="mode-note">在站内弹窗查看主体关系，支持滚轮和按钮缩放，不再跳到独立 URL 页面。</p>
              </div>
              <button id="graph-modal-close" class="secondary" type="button">关闭</button>
            </div>
            <iframe id="graph-modal-frame" class="graph-modal-frame" title="关系导航" loading="lazy"></iframe>
          </section>
        </div>
      </main>

      <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
      <script>
        const isLiveSessionTerminalStatus = ${isLiveSessionTerminalStatusSource};
        const createLivePollFailureTracker = ${createLivePollFailureTrackerSource};
        const sample = ${JSON.stringify(sample)};
        const presets = ${JSON.stringify(presets)};
        const supportedSourceLabels = ${JSON.stringify(SUPPORTED_NEWS_SOURCE_LABELS)};
        const pollFailureTracker = createLivePollFailureTracker();
        const state = {
          pollingTimer: null,
          sessionId: null,
          graphChart: null,
          graphModalChart: null,
          graphModalZoom: 1,
          lastSession: null,
          displaySession: null,
          acceptedSnapshotMeta: null,
          lastTerminalSnapshotMeta: null
        };
        const stageOrder = ['create', 'summary', 'entities', 'relations', 'graph'];
        const stageLabels = {
          create: '创建会话',
          summary: '事件判断',
          entities: '主体抽取',
          relations: '关系整理',
          graph: '结果归档'
        };
        const liveStatusLabels = {
          waiting: '等待中',
          queued: '已排队',
          running: '分析中',
          completed: '已完成',
          failed: '分析失败',
          interrupted: '连接中断',
          pending: '待执行'
        };
        const receiptMode = ${JSON.stringify(runtimeEnv.receiptMode)};
        const themeStorageKey = 'live-workbench-theme';
        const graphZoomMin = 0.7;
        const graphZoomMax = 2.4;
        const __name = (target, _value) => target;
        const rootElement = document.documentElement;
        const stageGrid = document.getElementById('stage-grid');
        const overallStatus = document.getElementById('overall-status');
        const themeToggle = document.getElementById('theme-toggle');
        const controlSummary = document.getElementById('control-summary');
        const controlPhase = document.getElementById('control-phase');
        const controlStepper = document.getElementById('control-stepper');
        const controlCardCurrentObject = document.getElementById('control-card-current-object');
        const controlCardSourceStatus = document.getElementById('control-card-source-status');
        const controlCardRunStatus = document.getElementById('control-card-run-status');
        const controlCardCredentialStatus = document.getElementById('control-card-credential-status');
        const controlCardNextAction = document.getElementById('control-card-next-action');
        const controlCurrentObject = document.getElementById('control-current-object');
        const controlSourceStatus = document.getElementById('control-source-status');
        const controlRunStatus = document.getElementById('control-run-status');
        const controlCredentialStatus = document.getElementById('control-credential-status');
        const controlNextAction = document.getElementById('control-next-action');
        const controlNextActionHint = document.getElementById('control-next-action-hint');
        const overviewCard = document.getElementById('overview-card');
        const eventHeadline = document.getElementById('event-headline');
        const eventSummary = document.getElementById('event-summary');
        const eventMetrics = document.getElementById('event-metrics');
        const judgmentList = document.getElementById('judgment-list');
        const evidencePreview = document.getElementById('evidence-preview');
        const deepReadingCopy = document.getElementById('deep-reading-copy');
        const deepReadingContext = document.getElementById('deep-reading-context');
        const deepReadingMeta = document.getElementById('deep-reading-meta');
        const sourcePreview = document.getElementById('source-preview');
        const entityPreview = document.getElementById('entity-preview');
        const credentialPreview = document.getElementById('credential-preview');
        const graphPreview = document.getElementById('graph-preview');
        const sourceDrawer = document.getElementById('source-drawer');
        const graphModal = document.getElementById('graph-modal');
        const graphModalScrim = document.getElementById('graph-modal-scrim');
        const graphModalClose = document.getElementById('graph-modal-close');
        const graphModalFrame = document.getElementById('graph-modal-frame');
        const explorerBaseUrl = ${JSON.stringify(getArcExplorerBaseUrl(runtimeEnv))};
        const formMessage = document.getElementById('form-message');
        const inputModeInput = document.getElementById('input-mode-input');
        const articleUrlField = document.getElementById('article-url-field');
        const articleUrlInput = document.getElementById('article-url-input');
        const manualFields = document.getElementById('manual-fields');
        const sourceTypeInput = document.getElementById('source-type-input');
        const textInput = document.getElementById('text-input');
        const startButton = document.getElementById('start-button');
        const fillSampleButton = document.getElementById('fill-sample-button');
        const presetButtons = document.querySelectorAll('.preset-launch-button');
        const trialFillButtons = document.querySelectorAll('.trial-fill-button');
        const detailShell = document.getElementById('detail-drawer');
        const detailScrim = document.getElementById('detail-scrim');
        const detailPanelClose = document.getElementById('detail-panel-close');
        const detailPanelKicker = document.getElementById('detail-panel-kicker');
        const detailPanelTitle = document.getElementById('detail-panel-title');
        const detailPanelSubtitle = document.getElementById('detail-panel-subtitle');
        const detailMainLabel = document.getElementById('detail-main-label');
        const detailMainCopy = document.getElementById('detail-main-copy');
        const detailQuoteSection = document.getElementById('detail-quote-section');
        const detailQuoteLabel = document.getElementById('detail-quote-label');
        const detailQuote = document.getElementById('detail-quote');
        const detailJudgmentMetaSection = document.getElementById('detail-judgment-meta-section');
        const detailJudgmentTags = document.getElementById('detail-judgment-tags');
        const detailSourceStatus = document.getElementById('detail-source-status');
        const detailEvidenceSection = document.getElementById('detail-evidence-section');
        const detailCurrentQuote = document.getElementById('detail-current-quote');
        const detailPreviousContextCard = document.getElementById('detail-previous-context-card');
        const detailPreviousQuote = document.getElementById('detail-previous-quote');
        const detailNextContextCard = document.getElementById('detail-next-context-card');
        const detailNextQuote = document.getElementById('detail-next-quote');
        const detailEvidenceSourceSite = document.getElementById('detail-evidence-source-site');
        const detailEvidenceImportMode = document.getElementById('detail-evidence-import-mode');
        const detailEvidenceImportStatus = document.getElementById('detail-evidence-import-status');
        const detailCachedAtRow = document.getElementById('detail-cached-at-row');
        const detailEvidenceCachedAt = document.getElementById('detail-evidence-cached-at');
        const detailPresetSection = document.getElementById('detail-preset-section');
        const detailPresetTitle = document.getElementById('detail-preset-title');
        const detailPresetSource = document.getElementById('detail-preset-source');
        const detailPresetCache = document.getElementById('detail-preset-cache');
        const detailPresetSummary = document.getElementById('detail-preset-summary');

        const applyWorkbenchTheme = (theme) => {
          const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
          rootElement.setAttribute('data-theme', normalizedTheme);

          if (themeToggle) {
            const nextThemeLabel = normalizedTheme === 'light' ? '切换到夜航' : '切换到晨雾';
            themeToggle.setAttribute('aria-label', nextThemeLabel);
            themeToggle.setAttribute('title', nextThemeLabel);
            themeToggle.setAttribute('data-theme-icon', normalizedTheme === 'light' ? 'moon' : 'sun');
            themeToggle.setAttribute('aria-pressed', normalizedTheme === 'dark' ? 'true' : 'false');
          }
        };

        const readStoredTheme = () => {
          try {
            return window.localStorage.getItem(themeStorageKey);
          } catch {
            return null;
          }
        };

        const persistTheme = (theme) => {
          try {
            window.localStorage.setItem(themeStorageKey, theme);
          } catch {}
        };
        const detailActions = document.getElementById('detail-actions');

        window.addEventListener('resize', () => {
          if (state.graphChart) {
            state.graphChart.resize();
          }

          if (state.graphModalChart) {
            state.graphModalChart.resize();
          }
        });

        const statusText = (status) => {
          if (!status) return liveStatusLabels.pending;
          return liveStatusLabels[status] ?? status;
        };
        ${formatImportStatusLabel.toString()}
        ${formatImportModeLabel.toString()}
        ${getStepStatus.toString()}
        ${extractSentences.toString()}
        ${getSummary.toString()}
        ${getEntities.toString()}
        ${getRelations.toString()}
        ${getSourceMetadata.toString()}
        ${getDisplayHeadline.toString()}
        ${getDisplaySourceTitle.toString()}
        ${isGeneratedSourceTitle.toString()}
        ${inferEventType.toString()}
        ${inferImportance.toString()}
        ${getDisplaySource.toString()}
        ${getTotalPrice.toString()}
        ${getGraphPresentationMode.toString()}
        ${getCurrentObjectCardTone.toString()}
        ${buildPreviewText.toString()}
        ${buildDetailSourceStatus.toString()}
        ${buildEvidenceDetail.toString()}
        ${buildJudgments.toString()}
        ${hasStableWorkbenchResult.toString()}
        ${shouldAcceptLiveSnapshot.toString()}
        ${getPhaseLabel.toString()}
        ${getPageStateSummary.toString()}
        ${createLiveWorkbenchViewModel.toString()}

        const escapeText = (value) => String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');

        const truncateMiddle = (value, head = 14, tail = 10) => {
          const text = String(value ?? '');
          if (text.length <= head + tail + 3) {
            return text;
          }

          return text.slice(0, head) + '...' + text.slice(-tail);
        };

        const isHexAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(String(value ?? ''));
        const isHexTransactionHash = (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value ?? ''));
        const createSnapshotMeta = (session) => {
          if (!session) {
            return null;
          }

          return {
            sessionId: session.sessionId ?? null,
            status: session.status ?? null,
            createdAt: session.createdAt ?? null,
            updatedAt: session.updatedAt ?? null,
            completedAt: session.completedAt ?? null,
            failedAt: session.failedAt ?? null
          };
        };

        const applyInputMode = (mode) => {
          const useLinkMode = mode === 'link';
          articleUrlField.classList.toggle('hidden', !useLinkMode);
          manualFields.classList.toggle('hidden', useLinkMode);
        };

        const copyField = async (button) => {
          const value = button?.dataset?.copyValue;

          if (!value) {
            return;
          }

          const previousLabel = button.textContent;

          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(value);
            } else {
              const textarea = document.createElement('textarea');
              textarea.value = value;
              textarea.setAttribute('readonly', 'readonly');
              textarea.style.position = 'absolute';
              textarea.style.left = '-9999px';
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              textarea.remove();
            }

            button.textContent = '已复制';
            button.disabled = true;
            window.setTimeout(() => {
              button.textContent = previousLabel;
              button.disabled = false;
            }, 1200);
          } catch (_error) {
            button.textContent = '复制失败';
            button.disabled = true;
            window.setTimeout(() => {
              button.textContent = previousLabel;
              button.disabled = false;
            }, 1200);
          }
        };

        const clampGraphZoom = (value) => Math.min(graphZoomMax, Math.max(graphZoomMin, value));
        const formatGraphZoomLabel = (zoom) => Math.round(clampGraphZoom(zoom) * 100) + '%';

        const syncGraphZoomLabel = (container, zoom) => {
          const label = container?.querySelector('#graph-zoom-label');

          if (label) {
            label.textContent = formatGraphZoomLabel(zoom);
          }
        };

        const syncGraphListZoom = (container, zoom) => {
          const listBody = container?.querySelector('.graph-list.zoomable .graph-list-body');

          if (listBody instanceof HTMLElement) {
            listBody.style.setProperty('--graph-list-zoom', String(clampGraphZoom(zoom)));
          }
        };

        const renderCopyableField = (label, value, options = {}) => {
          const normalizedValue = value ?? 'n/a';
          const copyButton = normalizedValue === 'n/a'
            ? ''
            : \`<button type="button" class="copy-button" data-copy-value="\${escapeText(normalizedValue)}" onclick="copyField(this)">复制</button>\`;
          const explorerButton = options.explorerUrl
            ? \`<a class="copy-button" href="\${escapeText(options.explorerUrl)}" target="_blank" rel="noreferrer">\${escapeText(options.explorerLabel ?? '浏览器')}</a>\`
            : '';

          return \`
            <div class="evidence-field">
              <div class="evidence-label">\${escapeText(label)}</div>
              <div class="evidence-value" title="\${escapeText(normalizedValue)}">\${escapeText(truncateMiddle(normalizedValue))}</div>
              \${explorerButton}
              \${copyButton}
            </div>
          \`;
        };

        const createMetricTile = (label, value) => \`
          <article class="metric-tile">
            <div class="metric-label">\${escapeText(label)}</div>
            <div class="metric-value">\${escapeText(value)}</div>
          </article>
        \`;

        const parseDetailPayload = (value) => {
          try {
            return JSON.parse(String(value ?? '{}'));
          } catch {
            return null;
          }
        };

        const renderDetailActions = (actions = []) => {
          if (!detailActions) {
            return;
          }

          detailActions.innerHTML = actions.map((action) => {
            if (action.type === 'link') {
              return \`<a class="detail-action-button" href="\${escapeText(action.href ?? '#')}" target="_blank" rel="noreferrer">\${escapeText(action.label ?? '打开链接')}</a>\`;
            }

            return \`<button type="button" class="detail-action-button" data-detail-action="\${escapeText(action.type ?? 'noop')}" data-preset-id="\${escapeText(action.presetId ?? '')}">\${escapeText(action.label ?? '执行操作')}</button>\`;
          }).join('');
        };

        const closeGraphModal = () => {
          if (!graphModal) {
            return;
          }

          if (state.graphModalChart) {
            state.graphModalChart.dispose();
            state.graphModalChart = null;
          }

          graphModal.classList.add('hidden');
          graphModal.setAttribute('aria-hidden', 'true');

          if (graphModalFrame) {
            graphModalFrame.removeAttribute('src');
          }
        };

        const closeDetailPanel = () => {
          if (!detailShell) {
            return;
          }

          detailShell.classList.add('hidden');
          detailShell.setAttribute('aria-hidden', 'true');
        };

        const openDetailPanel = (payload) => {
          if (
            !detailShell ||
            !detailPanelTitle ||
            !detailPanelSubtitle ||
            !detailPanelKicker ||
            !detailMainLabel ||
            !detailMainCopy ||
            !detailQuoteSection ||
            !detailQuoteLabel ||
            !detailQuote ||
            !detailJudgmentMetaSection ||
            !detailJudgmentTags ||
            !detailSourceStatus ||
            !detailEvidenceSection ||
            !detailCurrentQuote ||
            !detailPreviousContextCard ||
            !detailPreviousQuote ||
            !detailNextContextCard ||
            !detailNextQuote ||
            !detailEvidenceSourceSite ||
            !detailEvidenceImportMode ||
            !detailEvidenceImportStatus ||
            !detailCachedAtRow ||
            !detailEvidenceCachedAt ||
            !detailPresetSection ||
            !detailPresetTitle ||
            !detailPresetSource ||
            !detailPresetCache ||
            !detailPresetSummary ||
            !detailActions
          ) {
            return;
          }

          detailPanelKicker.textContent = payload.kicker || '详情';
          detailPanelTitle.textContent = payload.title || '未命名卡片';
          detailPanelSubtitle.textContent = payload.subtitle || '深度解读、相关上下文与可执行动作';
          detailMainLabel.textContent = payload.mainLabel || '正文';
          detailMainCopy.textContent = payload.mainText || '暂无更多说明。';

          detailQuoteLabel.textContent = payload.quoteLabel || '原始片段';
          detailQuote.textContent = payload.quote || '';
          detailQuoteSection.classList.toggle('hidden', !payload.quote);

          detailJudgmentMetaSection.classList.toggle('hidden', payload.kind !== 'judgment');
          detailJudgmentTags.innerHTML = (payload.tags ?? [])
            .map((entry) => \`<span class="meta-pill">\${escapeText(String(entry))}</span>\`)
            .join('');
          detailSourceStatus.textContent = payload.sourceStatus || '待补充';

          detailEvidenceSection.classList.toggle('hidden', payload.kind !== 'evidence');
          detailCurrentQuote.textContent = payload.currentQuote || '';
          detailPreviousQuote.textContent = payload.previousQuote || '';
          detailPreviousContextCard.classList.toggle('hidden', !payload.previousQuote);
          detailNextQuote.textContent = payload.nextQuote || '';
          detailNextContextCard.classList.toggle('hidden', !payload.nextQuote);
          detailEvidenceSourceSite.textContent = payload.evidenceSourceSite || '';
          detailEvidenceImportMode.textContent = payload.importModeLabel || '';
          detailEvidenceImportStatus.textContent = payload.importStatusLabel || '';
          detailEvidenceCachedAt.textContent = payload.cachedAt || '';
          detailCachedAtRow.classList.toggle('hidden', !payload.cachedAt);

          detailPresetSection.classList.toggle('hidden', payload.kind !== 'preset');
          detailPresetTitle.textContent = payload.presetTitle || payload.title || '';
          detailPresetSource.textContent = payload.presetSource || payload.source || '';
          detailPresetCache.textContent = payload.cacheNote || '';
          detailPresetSummary.textContent = payload.presetSummary || payload.mainText || '';

          renderDetailActions(payload.actions ?? []);
          detailShell.classList.remove('hidden');
          detailShell.setAttribute('aria-hidden', 'false');
        };

        const formatCredentialFieldValue = (step, field) => {
          if (field === 'payloadHash') {
            if (step.payloadHash) {
              return step.payloadHash;
            }

            return step.status === 'failed'
              ? '本步失败，未生成 payloadHash'
              : step.status === 'completed'
                ? '结果未返回 payloadHash'
                : '等待 payloadHash';
          }

          if (field === 'receiptTxHash') {
            if (step.receiptTxHash) {
              return step.receiptTxHash;
            }

            if (step.status === 'failed') {
              return '本步失败，未生成回执 hash';
            }

            if (step.status !== 'completed') {
              return '等待回执写入';
            }

            return receiptMode === 'off' ? '回执未启用' : '回执待写入';
          }

          return 'n/a';
        };

        const renderControlStepperFromStatuses = (statuses) => {
          if (!controlStepper) {
            return;
          }

          controlStepper.innerHTML = stageOrder.map((key, index) => \`
            <div id="control-step-\${key}" class="control-step" data-stage-key="\${key}" data-stage-status="\${statuses[key]}">
              <div class="control-step-marker">
                <span class="control-step-dot" aria-hidden="true"></span>
                \${index < stageOrder.length - 1 ? '<span class="control-step-line" aria-hidden="true"></span>' : ''}
              </div>
              <span class="control-step-name">\${stageLabels[key]}</span>
            </div>
          \`).join('');
        };

        const renderControlStepper = (session) => {
          renderControlStepperFromStatuses(buildDerivedStages(session));
        };

        const setControlCardTone = (element, tone) => {
          if (element) {
            element.setAttribute('data-card-tone', tone);
          }
        };

        const getControlCardTones = (session, workbenchModel) => {
          const successfulRuns = session?.agentSession?.totals?.successfulRuns
            ?? session?.steps?.filter((step) => step.status === 'completed').length
            ?? 0;
          const hasSource = Boolean(session?.source?.text?.trim() || session?.source?.metadata?.articleUrl);
          const pageTone = workbenchModel.pageStateTone;

          return {
            currentObject: getCurrentObjectCardTone(session, pageTone),
            sourceStatus:
              !hasSource
                ? 'idle'
                : session?.status === 'failed' && !hasStableWorkbenchResult(session)
                  ? 'failed'
                  : 'completed',
            runStatus: pageTone,
            credentialStatus:
              !session
                ? 'idle'
                : pageTone === 'failed' && successfulRuns === 0
                  ? 'failed'
                  : pageTone === 'running'
                    ? 'running'
                    : successfulRuns > 0
                      ? 'completed'
                      : pageTone === 'ready'
                        ? 'ready'
                        : 'idle',
            nextAction:
              !session
                ? 'idle'
                : pageTone === 'completed'
                  ? 'completed'
                  : pageTone === 'failed'
                    ? 'failed'
                    : pageTone === 'running'
                      ? 'running'
                      : 'ready'
          };
        };

        const renderControlStrip = (workbenchModel, session) => {
          if (!controlSummary || !controlPhase || !controlCurrentObject || !controlSourceStatus || !controlRunStatus || !controlCredentialStatus || !controlNextAction || !controlNextActionHint) {
            return;
          }

          controlSummary.textContent = workbenchModel.pageStateSummary;
          controlPhase.textContent = workbenchModel.phaseLabel;
          controlCurrentObject.textContent = workbenchModel.currentObjectValue;
          controlSourceStatus.textContent = workbenchModel.sourceStatusValue;
          controlRunStatus.textContent = workbenchModel.runStatusValue;
          controlCredentialStatus.textContent = workbenchModel.credentialStatusValue;
          controlNextAction.textContent = workbenchModel.nextActionLabel;
          controlNextActionHint.textContent = workbenchModel.nextActionHint;
          const cardTones = getControlCardTones(session, workbenchModel);
          setControlCardTone(controlCardCurrentObject, cardTones.currentObject);
          setControlCardTone(controlCardSourceStatus, cardTones.sourceStatus);
          setControlCardTone(controlCardRunStatus, cardTones.runStatus);
          setControlCardTone(controlCardCredentialStatus, cardTones.credentialStatus);
          setControlCardTone(controlCardNextAction, cardTones.nextAction);
          renderControlStepper(session);
        };

        const buildDerivedStages = (session) => {
          const createStatus = session ? 'completed' : 'pending';
          const graphStatus = !session
            ? 'pending'
            : session.status === 'completed'
              ? 'completed'
              : session.status === 'failed'
                ? 'failed'
                : 'running';

          return {
            create: createStatus,
            summary: getStepStatus(session, 'summary'),
            entities: getStepStatus(session, 'entities'),
            relations: getStepStatus(session, 'relations'),
            graph: graphStatus
          };
        };

        const renderEventOverview = (_session, workbenchModel) => {
          eventHeadline.textContent = workbenchModel.headline;
          eventSummary.textContent = workbenchModel.briefing;

          if (overviewCard) {
            overviewCard.setAttribute('data-detail-payload', JSON.stringify({
              kind: 'overview',
              kicker: '执行摘要',
              title: workbenchModel.headline,
              subtitle: '摘要延展',
              mainLabel: '摘要正文',
              mainText: workbenchModel.fullSummary || workbenchModel.briefing,
              tags: [
                workbenchModel.eventTypeValue,
                '重要性 ' + workbenchModel.importanceValue,
                workbenchModel.sourceModeValue
              ]
            }));
          }

          eventMetrics.innerHTML = [
            createMetricTile(
              workbenchModel.eventTypeValue === '待识别' ? '事件类型' : '事件类型（初步归类）',
              workbenchModel.eventTypeValue
            ),
            createMetricTile('重要性', workbenchModel.importanceValue),
            createMetricTile('来源方式', workbenchModel.sourceModeValue),
            createMetricTile('总成本', workbenchModel.totalPriceValue)
          ].join('');
        };

        const renderJudgments = (workbenchModel) => {
          const judgments = workbenchModel.judgments;

          if (judgments.length === 0) {
            judgmentList.innerHTML = \`
              <article class="judgment-card">
                <div class="section-kicker">事件判断</div>
                <h3>等待事件判断生成</h3>
                <p>只有在对应步骤完成后，页面才会显示初步判断，避免把原始文本误包装成已完成分析。</p>
              </article>
            \`;
            return;
          }

          judgmentList.innerHTML = judgments
            .map((judgment, index) => \`
              <article
                class="judgment-card card-detail-trigger"
                data-testid="judgment-card-\${index}"
                data-detail-payload="\${escapeText(JSON.stringify({
                  kind: 'judgment',
                  kicker: judgment.kicker,
                  title: judgment.title,
                  subtitle: '判断延展',
                  mainLabel: '判断正文',
                  mainText: judgment.body,
                  quoteLabel: '对应证据锚点',
                  quote: judgment.evidenceQuote,
                  tags: judgment.detailTags,
                  sourceStatus: judgment.detailSourceStatus
                }))}"
                tabindex="0"
                role="button"
              >
                <div class="section-kicker">\${escapeText(judgment.kicker)}</div>
                <h3>\${escapeText(judgment.title)}</h3>
                <p>\${escapeText(judgment.previewBody)}</p>
                <div class="evidence-quote">\${escapeText(judgment.previewQuote)}</div>
                <div class="judgment-meta">
                  \${judgment.meta.map((entry) => \`<span class="meta-pill">\${escapeText(entry)}</span>\`).join('')}
                </div>
              </article>
            \`)
            .join('');
        };

        const renderEvidenceDeck = (workbenchModel) => {
          const judgments = workbenchModel.judgments;

          if (judgments.length === 0) {
            evidencePreview.innerHTML = '<p class="muted">相关原文片段会在事件判断完成后出现，用于人工复核。</p>';
            return;
          }

          evidencePreview.innerHTML = \`
            <p class="source-note">\${escapeText(workbenchModel.evidenceSectionNote)}</p>
            \${judgments
            .map((judgment, index) => \`
              <article
                class="evidence-card card-detail-trigger"
                data-detail-payload="\${escapeText(JSON.stringify({
                  kind: 'evidence',
                  kicker: '证据锚点 ' + (index + 1),
                  title: judgment.evidenceTitle,
                  subtitle: workbenchModel.sourceLabel,
                  mainLabel: '说明',
                  mainText: judgment.evidenceRoleLine,
                  quoteLabel: '当前摘录',
                  quote: judgment.evidenceDetail.currentQuote,
                  currentQuote: judgment.evidenceDetail.currentQuote,
                  previousQuote: judgment.evidenceDetail.previousQuote,
                  nextQuote: judgment.evidenceDetail.nextQuote,
                  evidenceSourceSite: judgment.evidenceDetail.sourceSite,
                  importModeLabel: judgment.evidenceDetail.importModeLabel,
                  importStatusLabel: judgment.evidenceDetail.importStatusLabel,
                  cachedAt: judgment.evidenceDetail.cachedAt,
                  actions: [
                    judgment.evidenceDetail.articleUrl ? { type: 'link', label: '查看原文', href: judgment.evidenceDetail.articleUrl } : null,
                    state.displaySession?.graphUrl || state.lastSession?.graphUrl
                      ? { type: 'graph-expand', label: '展开关系导航' }
                      : null
                  ].filter(Boolean)
                }))}"
                tabindex="0"
                role="button"
              >
                <div class="section-kicker">摘录 \${index + 1}</div>
                <h3>\${escapeText(judgment.evidenceTitle)}</h3>
                <p>\${escapeText(judgment.previewBody)}</p>
                <div class="evidence-quote">\${escapeText(judgment.previewQuote)}</div>
                <p class="source-note">
                  \${escapeText(judgment.evidenceRoleLine)}
                  · 来源：\${escapeText(workbenchModel.sourceLabel)}
                  \${workbenchModel.importStatusLabel !== '未标记导入状态' ? ' · ' + escapeText(workbenchModel.importStatusLabel) : ''}
                </p>
              </article>
            \`)
            .join('')}
          \`;
        };

        const renderDeepReading = (session, workbenchModel) => {
          if (!deepReadingCopy || !deepReadingContext || !deepReadingMeta) {
            return;
          }

          if (!session) {
            deepReadingCopy.textContent = '完整摘要、延展判断与复核提示会在首轮结果返回后继续展开。';
            deepReadingContext.innerHTML = '';
            deepReadingMeta.innerHTML = '';
            return;
          }

          deepReadingCopy.textContent = workbenchModel.deepReadingLead;
          deepReadingContext.innerHTML = workbenchModel.deepReadingSections
            .map((section) => \`
              <article class="deep-reading-block">
                <h4>\${escapeText(section.title)}</h4>
                <p>\${escapeText(section.body)}</p>
              </article>
            \`)
            .join('');
          deepReadingMeta.innerHTML = [
            workbenchModel.phaseLabel,
            workbenchModel.sourceStatusValue,
            workbenchModel.credentialStatusValue,
            workbenchModel.pageStateTone === 'completed' ? '当前结果已接管工作台' : '当前轮次进行中'
          ]
            .filter(Boolean)
            .map((entry) => \`<span class="meta-pill">\${escapeText(entry)}</span>\`)
            .join('');
        };

        const renderSource = (session, workbenchModel) => {
          if (!session) {
            sourcePreview.innerHTML = '<p class="source-note">等待来源进入。</p>';
            return;
          }

          const displaySourceTitle = getDisplaySourceTitle(session);
          const titleLabel = isGeneratedSourceTitle(session) ? 'title（自动生成）' : 'title';

          sourcePreview.innerHTML = \`
            <article class="evidence-item">
              <h3>\${escapeText(workbenchModel.sourceLabel)}</h3>
              <p class="source-note">\${escapeText(workbenchModel.sourceTypeLabel)} · \${escapeText(workbenchModel.importModeLabel)} · \${escapeText(workbenchModel.importStatusLabel)}</p>
              \${displaySourceTitle ? renderCopyableField(titleLabel, displaySourceTitle) : ''}
              \${workbenchModel.articleUrl ? renderCopyableField('articleUrl', workbenchModel.articleUrl, { explorerUrl: workbenchModel.articleUrl, explorerLabel: '原文' }) : ''}
              \${workbenchModel.cachedAt ? renderCopyableField('cachedAt', workbenchModel.cachedAt) : ''}
            </article>
          \`;
        };

        const renderEntities = (workbenchModel) => {
          const entities = workbenchModel.entities;

          if (entities.length === 0) {
            if (workbenchModel.entityStepStatus === 'completed') {
              entityPreview.innerHTML = '<p class="muted">主体步骤已完成，但当前没有稳定主体。</p>';
              return;
            }

            if (workbenchModel.entityStepStatus === 'running') {
              entityPreview.innerHTML = '<p class="muted">主体识别进行中。</p>';
              return;
            }

            if (workbenchModel.entityStepStatus === 'failed') {
              entityPreview.innerHTML = '<p class="muted">主体步骤失败，请先查看凭证。</p>';
              return;
            }

            entityPreview.innerHTML = '<p class="muted">等待主体返回。</p>';
            return;
          }

          entityPreview.innerHTML = \`
            <div>
              \${entities
                .slice(0, 8)
                .map((entity) => \`<span class="entity-chip">\${escapeText(entity.name)}\${entity.type ? ' · ' + escapeText(entity.type) : ''}</span>\`)
                .join('')}
            </div>
            <p class="source-note">已识别 \${escapeText(String(entities.length))} 个主体，可结合关系导航继续扫清连接。</p>
          \`;
        };

        const renderCredentials = (session) => {
          if (!session) {
            credentialPreview.innerHTML = '等待凭证回填。';
            return;
          }

          const visibleSteps = (session.steps ?? []).filter((step) => step.status !== 'pending' || step.requestId);

          if (visibleSteps.length === 0) {
            credentialPreview.innerHTML = '分析链路尚未启动。';
            return;
          }

          credentialPreview.innerHTML = visibleSteps
            .map((step) => \`
              <article class="evidence-item">
                <h3>\${escapeText(stageLabels[step.key] ?? step.key)}</h3>
                <p class="source-note">状态：\${escapeText(statusText(step.status))}</p>
                \${renderCopyableField('requestId', step.requestId ?? 'n/a')}
                \${renderCopyableField('price', step.price ?? 'n/a')}
                \${renderCopyableField('paymentTransaction', step.paymentTransaction ?? 'n/a')}
                \${renderCopyableField(
                  'paymentPayer',
                  step.paymentPayer ?? 'n/a',
                  isHexAddress(step.paymentPayer)
                    ? {
                        explorerUrl: explorerBaseUrl + '/address/' + step.paymentPayer,
                        explorerLabel: '地址'
                      }
                    : {}
                )}
                \${renderCopyableField('payloadHash', formatCredentialFieldValue(step, 'payloadHash'))}
                \${renderCopyableField(
                  'receiptTxHash',
                  formatCredentialFieldValue(step, 'receiptTxHash'),
                  isHexTransactionHash(step.receiptTxHash)
                    ? {
                        explorerUrl: explorerBaseUrl + '/tx/' + step.receiptTxHash,
                        explorerLabel: '链上交易'
                      }
                    : {}
                )}
              </article>
            \`)
            .join('');
        };

        const disposeGraphChart = (chartKey = 'graphChart') => {
          if (state[chartKey]) {
            state[chartKey].dispose();
            state[chartKey] = null;
          }
        };

        const buildGraphCardHeader = (expandable, zoomable = false) => \`
            <div class="graph-preview-header">
              <div class="graph-preview-meta">
                <div class="stage-label">关系导航</div>
                <p class="graph-preview-note">\${zoomable ? '滚轮、拖拽与按钮缩放同时可用。' : '快速查看主体连接与上下游走向。'}</p>
              </div>
              <div class="graph-controls">
                \${zoomable
                  ? '<button type="button" class="copy-button graph-zoom-button" data-graph-zoom="out" aria-label="缩小图谱">-</button><span id="graph-zoom-label" class="graph-zoom-label">100%</span><button type="button" class="copy-button graph-zoom-button" data-graph-zoom="in" aria-label="放大图谱">+</button><button type="button" class="copy-button graph-zoom-button" data-graph-zoom="reset" aria-label="重置图谱">重置</button>'
                  : ''}
                \${expandable ? '<button type="button" class="copy-button graph-expand-button" data-graph-expand="true" data-testid="graph-expand-button" aria-label="弹窗查看关系导航" title="弹窗查看关系导航">弹窗</button>' : ''}
              </div>
            </div>
        \`;

        const renderGraphList = (container, nodes, edges, options = {}) => {
          const chartKey = options.chartKey ?? 'graphChart';
          const expandable = Boolean(options.expandable);
          const zoomable = Boolean(options.zoomable);
          const graphZoom = zoomable ? state.graphModalZoom : 1;

          disposeGraphChart(chartKey);
          container.innerHTML = \`
            \${buildGraphCardHeader(expandable, zoomable)}
            <div class="graph-list \${zoomable ? 'zoomable' : ''}">
              <div class="graph-list-body" style="\${zoomable ? '--graph-list-zoom:' + graphZoom + ';' : ''}">
                <div>
                  \${nodes
                    .slice(0, 6)
                    .map((node) => \`<span class="entity-chip">\${escapeText(node.label)}\${node.type ? ' · ' + escapeText(node.type) : ''}</span>\`)
                    .join('')}
                </div>
                <ul>
                  \${(edges.length > 0
                    ? edges
                    : [{ source: '工作台', label: '提示', target: '主体或关系不足，已降级为清单视图', provenance: 'derived' }])
                    .slice(0, 4)
                    .map((edge) => \`<li>\${escapeText(edge.source)} \${escapeText(edge.label)} \${escapeText(edge.target)}\${edge.provenance === 'derived' ? '（derived）' : ''}</li>\`)
                    .join('')}
                </ul>
              </div>
            </div>
          \`;

          if (zoomable) {
            syncGraphZoomLabel(container, graphZoom);
            syncGraphListZoom(container, graphZoom);
          }
        };

        const renderGraphSurface = (container, session, options = {}) => {
          const chartKey = options.chartKey ?? 'graphChart';
          const canvasId = options.canvasId ?? 'graph-canvas';
          const canvasClass = options.canvasClass ?? 'graph-canvas';
          const expandable = Boolean(options.expandable);
          const zoomable = Boolean(options.zoomable);

          if (!session?.agentSession?.graph) {
            disposeGraphChart(chartKey);
            container.innerHTML = '<p class="muted">等待关系返回。</p>';
            return;
          }

          const nodes = session.agentSession.graph.nodes ?? [];
          const edges = session.agentSession.graph.edges ?? [];
          const graphMode = getGraphPresentationMode(session);

          if (graphMode === 'list') {
            renderGraphList(container, nodes, edges, { chartKey, expandable, zoomable });
            return;
          }

          if (graphMode === 'empty') {
            disposeGraphChart(chartKey);
            container.innerHTML = '<p class="muted">等待关系返回。</p>';
            return;
          }

          container.innerHTML = \`
            \${buildGraphCardHeader(expandable, zoomable)}
            <div id="\${canvasId}" class="\${canvasClass}" role="img" aria-label="Auxiliary relationship graph"></div>
          \`;

          const graphCanvas = document.getElementById(canvasId);

          if (!graphCanvas || !window.echarts) {
            renderGraphList(container, nodes, edges, { chartKey, expandable, zoomable });
            return;
          }

          disposeGraphChart(chartKey);
          const isLightTheme = rootElement.getAttribute('data-theme') === 'light';
          const graphZoom = zoomable ? state.graphModalZoom : 1;
          state[chartKey] = window.echarts.init(graphCanvas, null, { renderer: 'svg' });
          state[chartKey].setOption({
            animationDuration: 420,
            tooltip: {
              trigger: 'item',
              backgroundColor: isLightTheme ? 'rgba(255, 255, 255, 0.96)' : 'rgba(5, 11, 20, 0.94)',
              borderColor: isLightTheme ? 'rgba(59, 130, 246, 0.18)' : 'rgba(140, 198, 255, 0.22)',
              textStyle: {
                color: isLightTheme ? '#102132' : '#edf4fb',
                fontSize: 12
              }
            },
            series: [
              {
                id: 'relationship-graph',
                type: 'graph',
                layout: 'none',
                roam: true,
                zoom: graphZoom,
                 label: {
                   show: true,
                   position: 'bottom',
                   color: '#f8fbff',
                   fontSize: 15,
                   fontWeight: 700,
                   backgroundColor: isLightTheme ? 'rgba(15, 23, 42, 0.78)' : 'rgba(5, 11, 20, 0.82)',
                   padding: [6, 10],
                   borderRadius: 999,
                   textBorderColor: isLightTheme ? 'rgba(15, 23, 42, 0.32)' : 'rgba(2, 6, 23, 0.92)',
                   textBorderWidth: 6,
                   shadowColor: 'rgba(2, 8, 23, 0.22)',
                   shadowBlur: 18
                 },
                 edgeLabel: {
                   show: true,
                   formatter: ({ data }) => data.value,
                   color: isLightTheme ? '#102132' : '#dbeafe',
                   fontSize: 12,
                   fontWeight: 700,
                   backgroundColor: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(5, 11, 20, 0.84)',
                   padding: [4, 8],
                   borderRadius: 999,
                   textBorderColor: isLightTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(2, 6, 23, 0.92)',
                   textBorderWidth: 4,
                   shadowColor: 'rgba(2, 8, 23, 0.16)',
                   shadowBlur: 12
                 },
                 lineStyle: {
                   color: isLightTheme ? '#7c8fa6' : '#8cc6ff',
                   width: 2.6,
                   curveness: 0.08
                 },
                emphasis: {
                  focus: 'adjacency'
                },
                data: nodes.map((node) => ({
                  id: node.id,
                  name: node.label,
                  value: node.type,
                  x: node.x,
                  y: node.y,
                  symbolSize: zoomable ? 64 : 58,
                  itemStyle: {
                    color: node.color,
                    borderColor: isLightTheme ? 'rgba(255, 255, 255, 0.94)' : 'rgba(237, 244, 251, 0.9)',
                    borderWidth: 2,
                    shadowColor: 'rgba(2, 8, 23, 0.26)',
                    shadowBlur: 18
                  }
                })),
                links: edges.map((edge) => ({
                  source: edge.source,
                  target: edge.target,
                  value: edge.label,
                  lineStyle: {
                    type: edge.provenance === 'derived' ? 'dashed' : 'solid',
                    opacity: edge.provenance === 'derived' ? 0.64 : 0.88
                  }
                }))
              }
            ]
          });

          syncGraphZoomLabel(container, graphZoom);

          if (zoomable) {
            state[chartKey].off('graphRoam');
            state[chartKey].on('graphRoam', () => {
              const currentZoom = Number(state[chartKey]?.getOption?.()?.series?.[0]?.zoom ?? state.graphModalZoom);
              state.graphModalZoom = clampGraphZoom(currentZoom);
              syncGraphZoomLabel(container, state.graphModalZoom);
            });
          }
        };

        const renderGraph = (session) => {
          renderGraphSurface(graphPreview, session, {
            chartKey: 'graphChart',
            canvasId: 'graph-canvas',
            canvasClass: 'graph-canvas',
            expandable: true,
            graphUrl: session?.graphUrl
          });
        };

        const toGraphEmbedUrl = (session) => {
          const fallbackUrl = '/arc/sd/graph/latest?embed=1';

          if (!session?.graphUrl) {
            return fallbackUrl;
          }

          try {
            const url = new URL(session.graphUrl, window.location.origin);
            url.searchParams.set('embed', '1');
            return url.href;
          } catch (_error) {
            return fallbackUrl;
          }
        };

        const openGraphModal = (session) => {
          if (!graphModal || !graphModalFrame) {
            return;
          }

          state.graphModalZoom = 1;
          graphModal.classList.remove('hidden');
          graphModal.setAttribute('aria-hidden', 'false');
          graphModalFrame.setAttribute('src', toGraphEmbedUrl(session));
        };

        const renderStages = (session) => {
          const statuses = buildDerivedStages(session);
          stageGrid.innerHTML = stageOrder.map((key) => \`
            <article class="stage-card" data-status="\${statuses[key]}">
              <div class="stage-label">\${stageLabels[key]}</div>
              <div class="stage-status">\${statusText(statuses[key])}</div>
            </article>
          \`).join('');
        };

        const getOverallStatusPresentation = (session, tone) => {
          const totalStages = stageOrder.length;

          if (!session) {
            return {
              icon: 'idle',
              meta: '0 / 5 阶段',
              progress: 0
            };
          }

          const statuses = buildDerivedStages(session);
          const completedStages = stageOrder.filter((key) => statuses[key] === 'completed').length;
          const runningStageIndex = stageOrder.findIndex((key) => statuses[key] === 'running');
          const failedStageIndex = stageOrder.findIndex((key) => statuses[key] === 'failed');
          const activeStageCount = runningStageIndex >= 0
            ? runningStageIndex + 1
            : failedStageIndex >= 0
              ? failedStageIndex + 1
              : completedStages;

          if (tone === 'completed') {
            return {
              icon: 'completed',
              meta: '5 / 5 阶段',
              progress: 100
            };
          }

          if (tone === 'failed') {
            return {
              icon: 'failed',
              meta: Math.max(activeStageCount, 1) + ' / ' + totalStages + ' 阶段',
              progress: Math.max(18, Math.min(92, Math.round((Math.max(activeStageCount - 0.3, 0.7) / totalStages) * 100)))
            };
          }

          if (tone === 'running') {
            return {
              icon: 'running',
              meta: Math.max(activeStageCount, 1) + ' / ' + totalStages + ' 阶段',
              progress: Math.max(24, Math.min(96, Math.round((Math.max(activeStageCount - 0.35, 0.9) / totalStages) * 100)))
            };
          }

          if (tone === 'ready') {
            return {
              icon: 'ready',
              meta: Math.max(completedStages, 1) + ' / ' + totalStages + ' 阶段',
              progress: Math.max(14, Math.round((Math.max(completedStages, 1) / totalStages) * 100))
            };
          }

          return {
            icon: 'idle',
            meta: '0 / 5 阶段',
            progress: 0
          };
        };

        const setOverallStatus = (workbenchModel, session) => {
          if (!overallStatus) {
            return;
          }

          const presentation = getOverallStatusPresentation(session, workbenchModel.pageStateTone);
          overallStatus.className = 'status-chip';
          overallStatus.setAttribute('data-status-tone', workbenchModel.pageStateTone);
          overallStatus.innerHTML = \`
            <span id="overall-status-icon" class="status-chip-icon" data-status-icon="\${presentation.icon}" aria-hidden="true"></span>
            <span class="status-chip-copy">
              <strong id="overall-status-label" class="status-chip-label">\${escapeText(workbenchModel.pageStateLabel)}</strong>
              <span id="overall-status-meta" class="status-chip-meta">\${escapeText(presentation.meta)}</span>
            </span>
            <span
              id="overall-status-progressbar"
              class="status-chip-progress"
              role="progressbar"
              aria-label="分析进度"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="\${presentation.progress}"
            >
              <span id="overall-status-progress" class="status-chip-progress-fill" style="width:\${presentation.progress}%"></span>
            </span>
          \`;
        };

        const stopPolling = () => {
          if (state.pollingTimer) {
            clearTimeout(state.pollingTimer);
            state.pollingTimer = null;
          }
        };

        const scheduleNextPoll = (sessionId) => {
          if (state.sessionId !== sessionId || state.pollingTimer) {
            return;
          }

          state.pollingTimer = window.setTimeout(() => {
            state.pollingTimer = null;
            void pollSession(sessionId);
          }, 1000);
        };

        const setLaunchControlsDisabled = (disabled) => {
          startButton.disabled = disabled;
          fillSampleButton.disabled = disabled;

          for (const button of presetButtons) {
            button.disabled = disabled;
          }
        };

        const setInterruptedState = () => {
          setOverallStatus(
            {
              pageStateLabel: statusText('interrupted'),
              pageStateTone: 'failed'
            },
            state.lastSession
          );
          formMessage.textContent = '分析连接已中断，请重新开始分析。';
          formMessage.className = 'error';
          setLaunchControlsDisabled(false);

          if (!state.lastSession) {
            return;
          }

          const statuses = buildDerivedStages(state.lastSession);
          renderControlStepperFromStatuses(
            Object.fromEntries(
              stageOrder.map((key) => [key, statuses[key] === 'completed' ? 'completed' : 'failed'])
            )
          );
          stageGrid.innerHTML = stageOrder.map((key) => {
            const baseStatus = statuses[key];
            const displayStatus = baseStatus === 'completed' ? 'completed' : 'failed';

            return \`
              <article class="stage-card" data-status="\${displayStatus}">
                <div class="stage-label">\${stageLabels[key]}</div>
                <div class="stage-status">\${statusText(displayStatus)}</div>
              </article>
            \`;
          }).join('');
        };

        const updateView = (session) => {
          state.lastSession = session;

          if (!session) {
            state.acceptedSnapshotMeta = null;
            state.lastTerminalSnapshotMeta = null;
          }

          if (session) {
            state.acceptedSnapshotMeta = createSnapshotMeta(session);

            if (isLiveSessionTerminalStatus(session.status)) {
              state.lastTerminalSnapshotMeta = createSnapshotMeta(session);
            }
          }

          const displaySession = session ?? null;
          state.displaySession = displaySession;
          setLaunchControlsDisabled(Boolean(session && (session.status === 'queued' || session.status === 'running')));

          if (session?.sessionId) {
            state.sessionId = session.sessionId;
            const importMode = session.source?.metadata?.importMode;
            const importStatus = session.source?.metadata?.importStatus;
            const cachedAt = session.source?.metadata?.cachedAt;
            const statusLabel = importStatus ? ' · 导入状态：' + formatImportStatusLabel(importStatus) : '';
            const cachedAtLabel = importStatus === 'cache' && cachedAt ? ' · 缓存时间：' + cachedAt : '';
            formMessage.textContent = importMode
              ? '当前 sessionId: ' + session.sessionId + ' · importMode=' + importMode + statusLabel + cachedAtLabel
              : '当前 sessionId: ' + session.sessionId + statusLabel + cachedAtLabel;
          }

          const workbenchModel = createLiveWorkbenchViewModel(displaySession, supportedSourceLabels);
          renderControlStrip(workbenchModel, session ?? displaySession);
          setOverallStatus(workbenchModel, session ?? displaySession);
          renderCredentials(displaySession ?? session);
          renderStages(session ?? displaySession);
          renderEventOverview(displaySession, workbenchModel);
          renderJudgments(workbenchModel);
          renderEvidenceDeck(workbenchModel);
          renderDeepReading(displaySession ?? session, workbenchModel);
          renderSource(session ?? displaySession, workbenchModel);
          renderEntities(workbenchModel);
          renderGraph(displaySession);

          if (graphModal && !graphModal.classList.contains('hidden')) {
            openGraphModal(displaySession);
          }
        };

        const fetchJson = async (path, options) => {
          const response = await fetch(path, {
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            ...options
          });

          if (response.status === 404) {
            return null;
          }

          const payload = await response.json();

          if (!response.ok) {
            throw Object.assign(new Error(payload.message ?? payload.error ?? 'Request failed.'), {
              payload,
              status: response.status
            });
          }

          return payload;
        };

        const pollSession = async (sessionId) => {
          try {
            const session = await fetchJson('${LIVE_PRODUCT_BASE_PATH}/session/' + sessionId);

            if (state.sessionId !== sessionId) {
              return;
            }

            if (session) {
              const snapshotGuardBase = state.lastTerminalSnapshotMeta ?? state.acceptedSnapshotMeta;

              if (!shouldAcceptLiveSnapshot(snapshotGuardBase, session)) {
                scheduleNextPoll(sessionId);
                return;
              }

              const successResult = pollFailureTracker.recordSuccess(session.status);
              updateView(session);

              if (successResult.shouldStopPolling) {
                stopPolling();
                return;
              }

              scheduleNextPoll(sessionId);
              return;
            }

            const failureResult = pollFailureTracker.recordFailure(state.lastSession?.status);

            if (failureResult.action !== 'interrupt') {
              scheduleNextPoll(sessionId);
              return;
            }

            setInterruptedState();
            stopPolling();
          } catch (error) {
            if (state.sessionId !== sessionId) {
              return;
            }

            const failureResult = pollFailureTracker.recordFailure(state.lastSession?.status);

            if (failureResult.action !== 'interrupt') {
              scheduleNextPoll(sessionId);
              return;
            }

            formMessage.textContent = error.message;
            formMessage.className = 'error';
            setInterruptedState();
            stopPolling();
          }
        };

        const startPolling = (sessionId) => {
          stopPolling();
          state.sessionId = sessionId;
          state.acceptedSnapshotMeta = null;
          state.lastTerminalSnapshotMeta = null;
          pollFailureTracker.reset();
          void pollSession(sessionId);
        };

        const focusWorkbenchResults = () => {
          if (sourceDrawer) {
            sourceDrawer.open = false;
          }

          requestAnimationFrame(() => {
            overviewCard?.scrollIntoView({
              block: 'start',
              inline: 'nearest',
              behavior: 'auto'
            });
          });
        };

        const createSession = async (payload) => {
          formMessage.textContent = '正在创建分析任务...';
          formMessage.className = 'muted';
          setLaunchControlsDisabled(true);

          try {
            const responsePayload = await fetchJson('${LIVE_PRODUCT_BASE_PATH}/session', {
              method: 'POST',
              body: JSON.stringify(payload)
            });

            if (!responsePayload) {
              return;
            }

            focusWorkbenchResults();
            startPolling(responsePayload.sessionId);
          } catch (error) {
            if (error?.status === 409 && error?.payload?.sessionId) {
              formMessage.textContent = '已有运行中的分析任务，已切回当前 session。';
              formMessage.className = 'muted';
              focusWorkbenchResults();
              startPolling(error.payload.sessionId);
              return;
            }

            const message = error?.payload?.sessionId
              ? error.message + ' sessionId=' + error.payload.sessionId
              : error.message;
            formMessage.textContent = message;
            formMessage.className = 'error';
            setLaunchControlsDisabled(false);
          }
        };

        fillSampleButton.addEventListener('click', () => {
          inputModeInput.value = 'manual';
          applyInputMode('manual');
          sourceTypeInput.value = sample.sourceType;
          textInput.value = sample.text;
          formMessage.textContent = '已填充示例文本。';
          formMessage.className = 'muted';
        });

        startButton.addEventListener('click', async () => {
          const mode = inputModeInput.value;
          const payload = mode === 'link'
            ? {
                articleUrl: articleUrlInput.value
              }
            : {
                text: textInput.value,
                sourceType: sourceTypeInput.value,
                metadata: {
                  importMode: 'manual'
                }
              };

          await createSession(payload);
        });

        inputModeInput.addEventListener('change', () => {
          applyInputMode(inputModeInput.value);
        });

        for (const button of presetButtons) {
          button.addEventListener('click', async () => {
            const presetId = button.dataset.presetId;
            const preset = presets.find((entry) => entry.id === presetId);

            if (!preset) {
              return;
            }

            inputModeInput.value = 'manual';
            applyInputMode('manual');
            articleUrlInput.value = preset.articleUrl;
            sourceTypeInput.value = preset.request.sourceType;
            textInput.value = preset.request.text;
            await createSession(preset.request);
          });
        }

        for (const button of trialFillButtons) {
          button.addEventListener('click', () => {
            const trialLink = button.getAttribute('data-trial-link');

            if (!trialLink) {
              return;
            }

            inputModeInput.value = 'link';
            applyInputMode('link');
            articleUrlInput.value = trialLink;
            formMessage.textContent = '已填入推荐试跑链接，可直接开始分析。';
            formMessage.className = 'muted';
            articleUrlInput.focus();
          });
        }

        if (detailShell) {
          detailShell.addEventListener('click', (event) => {
            if (event.target === detailScrim || event.target === detailPanelClose) {
              closeDetailPanel();
            }
          });
        }

        if (graphModal) {
          graphModal.addEventListener('click', (event) => {
            if (event.target === graphModalScrim || event.target === graphModalClose) {
              closeGraphModal();
            }
          });
        }

        document.addEventListener('click', async (event) => {
          const target = event.target;
          const graphExpandButton = target instanceof Element ? target.closest('[data-graph-expand]') : null;

          if (graphExpandButton) {
            const graphSession = state.displaySession ?? state.lastSession;

            if (graphSession) {
              openGraphModal(graphSession);
            }

            return;
          }

          const actionButton = target instanceof Element ? target.closest('[data-detail-action]') : null;

          if (!actionButton) {
            return;
          }

          const actionType = actionButton.getAttribute('data-detail-action');

          if (actionType === 'preset-launch') {
            const presetId = actionButton.getAttribute('data-preset-id');
            const preset = presets.find((entry) => entry.id === presetId);

            if (!preset) {
              return;
            }

            inputModeInput.value = 'manual';
            applyInputMode('manual');
            articleUrlInput.value = preset.articleUrl;
            sourceTypeInput.value = preset.request.sourceType;
            textInput.value = preset.request.text;
            closeDetailPanel();
            await createSession(preset.request);
            return;
          }

          if (actionType === 'graph-expand') {
            const graphSession = state.displaySession ?? state.lastSession;

            if (graphSession) {
              closeDetailPanel();
              openGraphModal(graphSession);
            }
          }
        });

        document.addEventListener('click', (event) => {
          const target = event.target;
          const trigger = target instanceof Element ? target.closest('.card-detail-trigger') : null;

          if (!trigger) {
            return;
          }

          if (target instanceof Element && target.closest('.preset-launch-button, .copy-button, a')) {
            return;
          }

          const payload = parseDetailPayload(trigger.getAttribute('data-detail-payload'));

          if (!payload) {
            return;
          }

          openDetailPanel(payload);
        });

        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            closeGraphModal();
            closeDetailPanel();
            return;
          }

          const target = event.target;
          const trigger = target instanceof Element ? target.closest('.card-detail-trigger') : null;

          if (target instanceof Element && target.closest('.preset-launch-button, .copy-button, a')) {
            return;
          }

          if (!trigger || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
          }

          event.preventDefault();
          const payload = parseDetailPayload(trigger.getAttribute('data-detail-payload'));

          if (!payload) {
            return;
          }

          openDetailPanel(payload);
        });

        if (themeToggle) {
          themeToggle.addEventListener('click', () => {
            const nextTheme = rootElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            applyWorkbenchTheme(nextTheme);
            persistTheme(nextTheme);

            const graphSession = state.displaySession ?? state.lastSession;

            if (graphSession) {
              renderGraph(graphSession);

              if (graphModal && !graphModal.classList.contains('hidden')) {
                openGraphModal(graphSession);
              }
            }
          });
        }

        const bootstrap = async () => {
          applyWorkbenchTheme(readStoredTheme() === 'dark' ? 'dark' : 'light');
          applyInputMode(inputModeInput.value);
          updateView(null);

          try {
            const active = await fetchJson('${LIVE_PRODUCT_BASE_PATH}/session/active');

            if (active) {
              updateView(active);

              if (active.status === 'queued' || active.status === 'running') {
                startPolling(active.sessionId);
              }
            }
          } catch (error) {
            formMessage.textContent = error.message;
            formMessage.className = 'error';
          }
        };

        window.copyField = copyField;
        void bootstrap();
      </script>
    </body>
  </html>`;
};

export const createLiveRouter = (options: CreateLiveRouterOptions) => {
  const router = Router();
  const presetProvider = new LiveNewsPresetProvider({
    newsImporter: options.newsImporter
  });

  router.get('/brand/logo.png', (_request, response) => {
    response.status(200).type('png').sendFile(LIVE_BRAND_LOGO_PATH);
  });

  router.get('/', async (_request, response) => {
    applyNoStoreHeaders(response);
    const presets = await presetProvider.listPresets().catch(() => liveNewsPresets);
    response.status(200).type('html').send(renderLiveConsolePage(options.runtimeEnv, presets));
  });

  router.post('/session', async (request, response) => {
    const parsedBody = parseCreateSessionBody((request.body ?? {}) as CreateSessionBody);

    if (parsedBody.kind === 'invalid') {
      logLiveRoute(options.runtimeEnv, 'reject invalid input', {
        reason: parsedBody.message
      });
      response.status(400).json({
        error: 'invalid_live_session_input',
        message: parsedBody.message
      });
      return;
    }

    const sessionInput =
      parsedBody.kind === 'link'
        ? await (async () => {
            try {
              logLiveRoute(options.runtimeEnv, 'start article import', {
                articleUrl: parsedBody.articleUrl
              });
              const importedArticle = await options.newsImporter.import(parsedBody.articleUrl);

              logLiveRoute(options.runtimeEnv, 'article import succeeded', {
                articleUrl: parsedBody.articleUrl,
                sourceSite: importedArticle.sourceSite,
                importStatus: importedArticle.importStatus ?? 'live',
                cachedAt: importedArticle.cachedAt ?? null
              });

              return {
                title: importedArticle.title,
                text: importedArticle.text,
                sourceType: importedArticle.sourceType,
                metadata: {
                  articleUrl: importedArticle.sourceUrl,
                  sourceSite: importedArticle.sourceSite,
                  importMode: 'link',
                  ...(importedArticle.importStatus ? { importStatus: importedArticle.importStatus } : {}),
                  ...(importedArticle.cachedAt ? { cachedAt: importedArticle.cachedAt } : {})
                } satisfies SourceMetadata
              };
            } catch (error) {
              const message = extractErrorMessage(options.runtimeEnv, error);
              logLiveRoute(options.runtimeEnv, 'article import failed', {
                articleUrl: parsedBody.articleUrl,
                message
              });
              response.status(400).json({
                error: 'news_import_failed',
                message: isAntiBotImportError(error) ? `${message} 建议改用预置卡片。` : message
              });
              return null;
            }
          })()
        : parsedBody.input;

    if (!sessionInput) {
      return;
    }

    const result = await options.liveSessionService.startSession(sessionInput);

    if (result.kind === 'conflict') {
      logLiveRoute(options.runtimeEnv, 'reject active session conflict', {
        sessionId: result.session.sessionId
      });
      response.status(409).json({
        error: 'live_session_active',
        sessionId: result.session.sessionId
      });
      return;
    }

    logLiveRoute(options.runtimeEnv, 'accepted live session', {
      sessionId: result.session.sessionId,
      mode: options.runtimeEnv.paymentMode,
      sourceType: sessionInput.sourceType ?? 'news',
      importMode: sessionInput.metadata?.importMode ?? 'manual',
      importStatus: sessionInput.metadata?.importStatus ?? null,
      articleUrl: sessionInput.metadata?.articleUrl ?? null
    });

    response.status(202).json({
      sessionId: result.session.sessionId,
      status: result.session.status
    });
  });

  router.get('/session/latest', async (_request, response) => {
    applyNoStoreHeaders(response);
    const session = await options.liveSessionService.readLatestSession();

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  router.get('/session/active', async (_request, response) => {
    applyNoStoreHeaders(response);
    const session = await options.liveSessionService.readActiveSession();

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  router.get('/session/:sessionId', async (request, response) => {
    applyNoStoreHeaders(response);
    const session = await options.liveSessionService.readSession(request.params.sessionId);

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  return router;
};
