import { Router } from 'express';
import type { Response } from 'express';

import type { RuntimeEnv } from '../config/env.js';
import { demoCorpus } from '../demo/corpus.js';
import { LiveAgentSessionService } from '../demo/live-session.js';
import { liveNewsPresets } from '../demo/news-presets.js';
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
  getPageStateSummary,
  getPhaseLabel,
  getGraphPresentationMode,
  getRelations,
  getSourceMetadata,
  getStepStatus,
  getSummary,
  getTotalPrice,
  hasRetainedWorkbenchResult,
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

const renderLiveConsolePage = (runtimeEnv: RuntimeEnv): string => {
  const sample = demoCorpus[0];
  const isLiveSessionTerminalStatusSource = isLiveSessionTerminalStatus.toString();
  const createLivePollFailureTrackerSource = createLivePollFailureTracker.toString();
  const presetCards = liveNewsPresets
    .map(
      (preset) => `
        <article
          class="preset-launcher card-detail-trigger"
          data-preset-id="${escapeHtml(preset.id)}"
          data-detail-payload="${escapeHtml(JSON.stringify({
            kind: 'preset',
            kicker: '预置资讯卡',
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
            <span>${escapeHtml(SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite])}</span>
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
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>可信投研工作台</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f7f2e7;
          --paper: rgba(255, 251, 245, 0.92);
          --ink: #1f2937;
          --muted: #6b7280;
          --line: rgba(31, 41, 55, 0.12);
          --accent: #0f766e;
          --accent-soft: rgba(15, 118, 110, 0.12);
          --gold: #b45309;
          --danger: #b91c1c;
        }

        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Baskerville", "Iowan Old Style", serif;
          color: var(--ink);
          background:
            radial-gradient(circle at top left, rgba(180, 83, 9, 0.18), transparent 24rem),
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.18), transparent 20rem),
            linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
        }

        main {
          max-width: 1280px;
          margin: 0 auto;
          padding: 28px 18px 48px;
        }

        .control-strip,
        .toolbelt-shell {
          margin-bottom: 18px;
          padding: 22px;
        }

        .control-strip h1 {
          margin: 0 0 8px;
          font-size: clamp(2rem, 4vw, 3.2rem);
          line-height: 0.96;
        }

        .control-grid,
        .toolbelt-actions {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .control-card {
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.82);
          padding: 16px;
        }

        .control-card-wide {
          grid-column: span 2;
        }

        .control-label {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 10px;
        }

        .control-value {
          font-size: 18px;
          line-height: 1.45;
        }

        .hero, .panel {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 28px;
          box-shadow: 0 22px 48px rgba(31, 41, 55, 0.08);
          backdrop-filter: blur(18px);
          position: relative;
          overflow: hidden;
        }

        .hero {
          padding: 26px;
          margin-bottom: 18px;
        }

        .hero::before,
        .panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.42), transparent 34%, rgba(15, 118, 110, 0.03));
          pointer-events: none;
        }

        .hero > *,
        .panel > * {
          position: relative;
          z-index: 1;
        }

        .eyebrow {
          display: inline-flex;
          gap: 10px;
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .hero h1 {
          margin: 12px 0 10px;
          font-size: clamp(2.2rem, 5vw, 4rem);
          line-height: 0.95;
        }

        .hero p {
          max-width: 70ch;
          color: var(--muted);
          font-size: 18px;
          line-height: 1.6;
        }

        .layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }

        .input-panel {
          order: 0;
          position: static;
        }

        .result-panel {
          order: 1;
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
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(255, 255, 255, 0.92);
          color: var(--ink);
        }

        textarea {
          min-height: 220px;
          resize: vertical;
          line-height: 1.6;
        }

        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        button {
          border: none;
          border-radius: 999px;
          padding: 13px 18px;
          cursor: pointer;
          transition: transform 140ms ease, box-shadow 140ms ease;
        }

        button:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 22px rgba(15, 23, 42, 0.1);
        }

        .primary {
          background: linear-gradient(135deg, #0f766e, #115e59);
          color: white;
        }

        .secondary {
          background: var(--accent-soft);
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
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.72);
          overflow: hidden;
        }

        .source-drawer[open] {
          background: rgba(255, 255, 255, 0.82);
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
          border: 1px solid rgba(15, 118, 110, 0.18);
          background: rgba(15, 118, 110, 0.08);
          color: var(--accent);
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
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.82);
          padding: 16px;
          display: grid;
          gap: 10px;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }

        .preset-card:hover,
        .preset-launcher:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 28px rgba(31, 41, 55, 0.08);
          border-color: rgba(15, 118, 110, 0.24);
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
          color: var(--gold);
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
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          font-size: 14px;
        }

        .status-chip.failed {
          background: rgba(185, 28, 28, 0.1);
          color: var(--danger);
        }

        .stage-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .stage-card, .evidence-card {
          border-radius: 22px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.82);
          padding: 16px;
        }

        .stage-card[data-status="running"] {
          border-color: rgba(15, 118, 110, 0.4);
          background: rgba(15, 118, 110, 0.08);
        }

        .stage-card[data-status="completed"] {
          border-color: rgba(15, 118, 110, 0.28);
        }

        .stage-card[data-status="failed"] {
          border-color: rgba(185, 28, 28, 0.28);
          background: rgba(185, 28, 28, 0.06);
        }

        .stage-label {
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--gold);
        }

        .stage-status {
          margin-top: 8px;
          font-size: 20px;
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
          border: 1px solid rgba(148, 163, 184, 0.22);
          background:
            radial-gradient(circle at top left, rgba(15, 118, 110, 0.08), transparent 10rem),
            rgba(255, 255, 255, 0.82);
          min-height: 260px;
          padding: 18px;
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

        .graph-expand-button {
          white-space: nowrap;
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
          border: 1px solid rgba(148, 163, 184, 0.22);
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 14rem),
            rgba(255, 251, 245, 0.985);
          box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
          padding: 22px;
        }

        .graph-modal-preview {
          min-height: 0;
          margin-top: 0;
        }

        .graph-modal-canvas {
          width: 100%;
          min-height: min(72vh, 820px);
        }

        .graph-list {
          display: grid;
          gap: 12px;
        }

        .graph-list ul {
          margin: 0;
          padding-left: 18px;
          color: var(--muted);
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
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(248, 250, 252, 0.88);
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
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.18);
          font-family: "SFMono-Regular", "Menlo", monospace;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .copy-button {
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
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
          margin-bottom: 18px;
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
          line-height: 1.6;
        }

        .workbench-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.78fr);
          gap: 18px;
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
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.82);
          padding: 18px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 14px 28px rgba(31, 41, 55, 0.05);
        }

        .overview-card {
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 14rem),
            linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
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
          background: linear-gradient(90deg, rgba(180, 83, 9, 0.66), rgba(15, 118, 110, 0.66), transparent);
        }

        .section-kicker {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 10px;
        }

        .overview-card h3 {
          margin: 0 0 10px;
          font-size: clamp(1.4rem, 2.8vw, 2.3rem);
          line-height: 1.05;
        }

        .overview-card p {
          margin: 0;
          color: var(--muted);
          font-size: 16px;
          line-height: 1.78;
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
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.92);
        }

        .metric-label {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 8px;
        }

        .metric-value {
          font-size: 20px;
          line-height: 1.2;
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
            radial-gradient(circle at top right, rgba(180, 83, 9, 0.08), transparent 12rem),
            linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(250, 250, 249, 0.92));
        }

        .judgment-card p,
        .sidebar-card p,
        .evidence-card p {
          margin: 0;
          color: var(--muted);
          font-size: 16px;
          line-height: 1.72;
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
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          font-size: 12px;
        }

        .evidence-quote {
          margin-top: 12px;
          padding: 14px;
          border-radius: 18px;
          background: rgba(248, 250, 252, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.18);
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
          background: rgba(180, 83, 9, 0.1);
          color: var(--gold);
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
          border: 1px solid rgba(148, 163, 184, 0.22);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(249, 247, 242, 0.92));
          padding: 20px;
          box-shadow: 0 14px 28px rgba(31, 41, 55, 0.05);
        }

        .deep-reading-card p {
          margin: 0;
          color: var(--ink);
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
          border-top: 1px solid rgba(148, 163, 184, 0.16);
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
          color: var(--gold);
        }

        .deep-reading-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }

        .credential-list .evidence-item {
          background: rgba(248, 250, 252, 0.92);
        }

        .meta-section {
          display: grid;
          gap: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(148, 163, 184, 0.16);
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
          background: rgba(15, 23, 42, 0.44);
          backdrop-filter: blur(8px);
        }

        .detail-panel {
          position: absolute;
          top: 0;
          right: 0;
          width: min(480px, 42vw);
          height: 100vh;
          overflow: auto;
          border-left: 1px solid rgba(148, 163, 184, 0.22);
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 12rem),
            rgba(255, 251, 245, 0.985);
          box-shadow: -16px 0 48px rgba(15, 23, 42, 0.2);
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
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.78);
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
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.94);
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
          color: var(--gold);
        }

        .detail-context-grid {
          display: grid;
          gap: 10px;
        }

        .detail-context-card {
          display: grid;
          gap: 6px;
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(248, 250, 252, 0.92);
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
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
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
            order: 2;
          }

          .result-panel {
            order: 1;
          }

          textarea {
            min-height: 180px;
          }
        }

        @media (max-width: 720px) {
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
      <main>
        <section class="panel control-strip toolbelt-shell">
          <div class="section-kicker">顶部工具带</div>
          <div class="workbench-top">
            <div>
              <h1>可信投研工作台</h1>
              <p id="control-summary">页面状态：待导入 / 待分析 / 分析中 / 分析完成 / 分析失败。首屏固定服务“事件总览 -> 关键判断 -> 证据摘录”，证据摘录会固定留在主区。导入状态：实时抓取 / 导入状态：缓存回退 / 缓存时间 会在来源状态与分析元信息里持续可见。</p>
              <p id="control-phase" class="mode-note">阶段：尚未进入分析阶段</p>
            </div>
            <div id="overall-status" class="status-chip">待导入</div>
          </div>
          <div class="control-grid toolbelt-actions">
            <article class="control-card">
              <div class="control-label">当前对象</div>
              <div id="control-current-object" class="control-value">等待分析开始</div>
            </article>
            <article class="control-card">
              <div class="control-label">来源状态</div>
              <div id="control-source-status" class="control-value">待导入</div>
            </article>
            <article class="control-card">
              <div class="control-label">运行状态</div>
              <div id="control-run-status" class="control-value">待导入 · 尚未进入分析阶段</div>
            </article>
            <article class="control-card">
              <div class="control-label">凭证状态</div>
              <div id="control-credential-status" class="control-value">待生成凭证</div>
            </article>
            <article class="control-card control-card-wide">
              <div class="control-label">下一步动作</div>
              <div id="control-next-action" class="control-value">导入材料</div>
              <p id="control-next-action-hint" class="mode-note">从导入仓开始一次新分析。</p>
            </article>
          </div>
        </section>

        <section class="layout">
          <article class="panel input-panel">
            <details id="source-drawer" class="source-drawer">
              <summary class="source-drawer-summary" data-testid="source-drawer-toggle">
                <div class="source-drawer-copy">
                  <div class="section-kicker">导入仓</div>
                  <h2>收纳式导入仓</h2>
                  <p>输入入口默认退入工具行为。需要更换材料时，再展开导入来源、手动文本与预置启动器。</p>
                </div>
                <span class="source-drawer-toggle">展开导入来源</span>
              </summary>
              <div class="source-drawer-grid input-grid">
                <label>
                  输入模式
                  <select id="input-mode-input">
                    <option value="link">文章链接</option>
                    <option value="manual" selected>手动文本</option>
                  </select>
                </label>
                <p class="mode-note">默认使用手动正文输入。支持站点：${escapeHtml(Object.values(SUPPORTED_NEWS_SOURCE_LABELS).join(' / '))}。手动模式下系统会基于正文自动生成展示标题；链接模式会提交到 /demo/live/session 并先执行导入。</p>

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
                  <p class="muted">预置资讯只作为启动器使用。先看摘要与原始片段，再决定是否直接启动分析。</p>
                </section>
                <section class="preset-grid preset-launcher-grid">${presetCards}</section>
              </div>
            </details>
          </article>

          <article class="panel result-panel">
            <section class="workbench-grid" aria-live="polite">
              <div class="workbench-main main-reading-rail">
                <article id="overview-card" class="overview-card card-detail-trigger" tabindex="0" role="button">
                  <div class="section-kicker">事件总览</div>
                  <div class="card-detail-hint">完整摘要</div>
                  <h3 id="event-headline">等待分析开始</h3>
                  <p id="event-summary">选择一条资讯后，系统会先生成事件判断，再补全主体、证据和分析凭证。</p>
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
                    <h3>关键判断</h3>
                    <p class="muted">每条判断都应回答“为什么重要”。关键判断需要证据挂钩；没有证据锚点时，判断卡会先保留为待核验提示。</p>
                  </div>
                  <div id="judgment-list" class="judgment-grid">
                    <article class="judgment-card">
                      <div class="section-kicker">关键判断</div>
                      <h3>等待事件判断生成</h3>
                      <p>summary 完成后，这里会优先出现 2-3 条可继续跟进的结论。</p>
                    </article>
                  </div>
                </section>

                <section>
                  <div class="section-heading">
                    <h3>证据摘录</h3>
                    <p class="muted">证据摘录会固定留在主区，帮助人工复核判断；暂不宣称已完成逐句证据对齐。</p>
                  </div>
                  <div id="evidence-preview" class="evidence-list muted">尚无可回看的原文证据。</div>
                </section>

                <section class="deep-reading-section">
                  <div class="section-heading">
                    <h3>延展阅读</h3>
                    <p class="muted">完整摘要、延展判断与复核提示会在这里继续展开，不打断首屏的主阅读链。</p>
                  </div>
                  <article class="deep-reading-card">
                    <p id="deep-reading-copy">完整摘要、延展判断与复核提示会在首轮结果返回后继续展开。</p>
                    <div id="deep-reading-context" class="deep-reading-blocks"></div>
                    <div id="deep-reading-meta" class="deep-reading-meta"></div>
                  </article>
                </section>
              </div>

              <aside class="workbench-sidebar">
                <section class="section-heading sidebar-heading">
                  <h3>情报侧栏</h3>
                  <p class="muted">右侧保持稳定顺序：导入来源、核心主体、辅助关系图、分析凭证、分析流程，不与主结论区争抢焦点。</p>
                </section>

                <article class="sidebar-card">
                  <div class="section-kicker">导入来源</div>
                  <div id="source-preview" class="source-list">
                    <p class="source-note">可通过链接导入、手动文本或预置样本启动分析，来源方式与导入状态会在这里持续展示。</p>
                  </div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">核心主体</div>
                  <div id="entity-preview" class="entity-list muted">摘要与实体抽取完成后，这里会显示本次最值得关注的主体。</div>
                </article>

                <article class="sidebar-card graph-card">
                  <div class="section-kicker">辅助关系图</div>
                  <section id="graph-preview" class="graph-preview graph-surface" aria-live="polite">
                    <p class="muted">辅助关系图会在这里显示，用于快速扫清主体之间的连接，不承担主结论职责。</p>
                  </section>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">分析凭证</div>
                  <div id="credential-preview" class="credential-list muted">payment、receipt 与 payloadHash 会在这里统一展示。</div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">分析流程</div>
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
                <p id="detail-panel-subtitle" class="mode-note">右侧详情抽屉承接延展阅读、证据上下文与后续动作。</p>
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
                <h3>关键判断详情</h3>
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
                <h3>证据摘录详情</h3>
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
                <div class="section-kicker">关系图展开</div>
                <h2 id="graph-modal-title">辅助关系图</h2>
                <p class="mode-note">在站内放大查看主体关系，不再跳到独立 URL 页面。</p>
              </div>
              <button id="graph-modal-close" class="secondary" type="button">关闭</button>
            </div>
            <section id="graph-modal-preview" class="graph-preview graph-surface graph-modal-preview" aria-live="polite"></section>
          </section>
        </div>
      </main>

      <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
      <script>
        const isLiveSessionTerminalStatus = ${isLiveSessionTerminalStatusSource};
        const createLivePollFailureTracker = ${createLivePollFailureTrackerSource};
        const sample = ${JSON.stringify(sample)};
        const presets = ${JSON.stringify(liveNewsPresets)};
        const supportedSourceLabels = ${JSON.stringify(SUPPORTED_NEWS_SOURCE_LABELS)};
        const pollFailureTracker = createLivePollFailureTracker();
        const state = {
          pollingTimer: null,
          sessionId: null,
          graphChart: null,
          graphModalChart: null,
          lastSession: null,
          stableResultSession: null,
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
        const __name = (target, _value) => target;
        const stageGrid = document.getElementById('stage-grid');
        const overallStatus = document.getElementById('overall-status');
        const controlSummary = document.getElementById('control-summary');
        const controlPhase = document.getElementById('control-phase');
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
        const graphModal = document.getElementById('graph-modal');
        const graphModalScrim = document.getElementById('graph-modal-scrim');
        const graphModalClose = document.getElementById('graph-modal-close');
        const graphModalPreview = document.getElementById('graph-modal-preview');
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
        ${buildPreviewText.toString()}
        ${buildDetailSourceStatus.toString()}
        ${buildEvidenceDetail.toString()}
        ${buildJudgments.toString()}
        ${hasStableWorkbenchResult.toString()}
        ${hasRetainedWorkbenchResult.toString()}
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

        const cloneSession = (session) => {
          if (!session) {
            return null;
          }

          return JSON.parse(JSON.stringify(session));
        };

        const createDisplaySession = (session, stableResultSession) => {
          if (!session) {
            return null;
          }

          if (!stableResultSession || stableResultSession.sessionId === session.sessionId) {
            return session;
          }

          if ((session.status !== 'running' && session.status !== 'failed') || hasStableWorkbenchResult(session)) {
            return session;
          }

          const retainedPreview = stableResultSession.preview ?? {
            summary: stableResultSession.agentSession?.summary,
            entities: stableResultSession.agentSession?.entities,
            relations: stableResultSession.agentSession?.relations
          };

          return {
            ...cloneSession(stableResultSession),
            sessionId: session.sessionId,
            status: session.status,
            mode: session.mode,
            error: session.error,
            graphUrl: session.graphUrl ?? stableResultSession.graphUrl,
            source: cloneSession(session.source ?? stableResultSession.source),
            steps: cloneSession(session.steps ?? []),
            preview: cloneSession(retainedPreview),
            agentSession: cloneSession(stableResultSession.agentSession)
          };
        };

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
          detailPanelSubtitle.textContent = payload.subtitle || '延展阅读、相关上下文与可执行动作';
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

        const renderControlStrip = (workbenchModel) => {
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
              kicker: '事件总览',
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
                  quoteLabel: '对应证据摘录',
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
                  kicker: '证据摘录 ' + (index + 1),
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
                      ? { type: 'graph-expand', label: '展开辅助关系图' }
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
            workbenchModel.hasRetainedResult ? '旧结果保留中' : '当前结果已接管工作台'
          ]
            .filter(Boolean)
            .map((entry) => \`<span class="meta-pill">\${escapeText(entry)}</span>\`)
            .join('');
        };

        const renderSource = (session, workbenchModel) => {
          if (!session) {
            sourcePreview.innerHTML = '<p class="source-note">可通过链接导入、手动文本或预置样本启动分析，来源方式与导入状态会在这里持续展示。</p>';
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
              entityPreview.innerHTML = '<p class="muted">实体步骤已完成，但当前没有返回稳定主体，建议结合原文继续人工复核。</p>';
              return;
            }

            if (workbenchModel.entityStepStatus === 'running') {
              entityPreview.innerHTML = '<p class="muted">实体步骤进行中，核心主体会在返回后出现在这里。</p>';
              return;
            }

            if (workbenchModel.entityStepStatus === 'failed') {
              entityPreview.innerHTML = '<p class="muted">实体步骤未完成，建议先查看分析凭证与错误信息。</p>';
              return;
            }

            entityPreview.innerHTML = '<p class="muted">核心主体会在实体步骤开始返回后逐步出现。</p>';
            return;
          }

          entityPreview.innerHTML = \`
            <div>
              \${entities
                .slice(0, 8)
                .map((entity) => \`<span class="entity-chip">\${escapeText(entity.name)}\${entity.type ? ' · ' + escapeText(entity.type) : ''}</span>\`)
                .join('')}
            </div>
            <p class="source-note">已识别 \${escapeText(String(entities.length))} 个主体，可结合辅助关系图继续扫清连接。</p>
          \`;
        };

        const renderCredentials = (session) => {
          if (!session) {
            credentialPreview.innerHTML = 'payment、receipt 与 payloadHash 会在这里统一展示。';
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

        const buildGraphCardHeader = (expandable) => \`
            <div class="graph-preview-header">
              <div class="stage-label">辅助关系图</div>
              \${expandable ? '<button type="button" class="copy-button graph-expand-button" data-graph-expand="true" data-testid="graph-expand-button">展开关系图</button>' : ''}
            </div>
        \`;

        const renderGraphList = (container, nodes, edges, options = {}) => {
          const chartKey = options.chartKey ?? 'graphChart';
          const expandable = Boolean(options.expandable);

          disposeGraphChart(chartKey);
          container.innerHTML = \`
            \${buildGraphCardHeader(expandable)}
            <div class="graph-list">
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
          \`;
        };

        const renderGraphSurface = (container, session, options = {}) => {
          const chartKey = options.chartKey ?? 'graphChart';
          const canvasId = options.canvasId ?? 'graph-canvas';
          const canvasClass = options.canvasClass ?? 'graph-canvas';
          const expandable = Boolean(options.expandable);

          if (!session?.agentSession?.graph) {
            disposeGraphChart(chartKey);
            container.innerHTML = '<p class="muted">辅助关系图会在摘要、主体和关系补齐后出现，弱数据场景会自动降级为清单视图。</p>';
            return;
          }

          const nodes = session.agentSession.graph.nodes ?? [];
          const edges = session.agentSession.graph.edges ?? [];
          const graphMode = getGraphPresentationMode(session);

          if (graphMode === 'list') {
            renderGraphList(container, nodes, edges, { chartKey, expandable });
            return;
          }

          if (graphMode === 'empty') {
            disposeGraphChart(chartKey);
            container.innerHTML = '<p class="muted">辅助关系图会在摘要、主体和关系补齐后出现，弱数据场景会自动降级为清单视图。</p>';
            return;
          }

          container.innerHTML = \`
            \${buildGraphCardHeader(expandable)}
            <div id="\${canvasId}" class="\${canvasClass}" role="img" aria-label="Auxiliary relationship graph"></div>
          \`;

          const graphCanvas = document.getElementById(canvasId);

          if (!graphCanvas || !window.echarts) {
            renderGraphList(container, nodes, edges, { chartKey, expandable });
            return;
          }

          disposeGraphChart(chartKey);
          state[chartKey] = window.echarts.init(graphCanvas, null, { renderer: 'svg' });
          state[chartKey].setOption({
            animationDuration: 420,
            tooltip: {
              trigger: 'item'
            },
            series: [
              {
                type: 'graph',
                layout: 'none',
                roam: true,
                label: {
                  show: true,
                  position: 'bottom',
                  color: '#0f172a',
                  fontSize: 12
                },
                edgeLabel: {
                  show: true,
                  formatter: ({ data }) => data.value,
                  color: '#334155',
                  fontSize: 11
                },
                lineStyle: {
                  color: '#94a3b8',
                  width: 2,
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
                  symbolSize: 52,
                  itemStyle: {
                    color: node.color
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
        };

        const renderGraph = (session) => {
          renderGraphSurface(graphPreview, session, {
            chartKey: 'graphChart',
            canvasId: 'graph-canvas',
            canvasClass: 'graph-canvas',
            expandable: true
          });
        };

        const openGraphModal = (session) => {
          if (!graphModal || !graphModalPreview) {
            return;
          }

          graphModal.classList.remove('hidden');
          graphModal.setAttribute('aria-hidden', 'false');

          requestAnimationFrame(() => {
            if (graphModal.classList.contains('hidden')) {
              return;
            }

            renderGraphSurface(graphModalPreview, session, {
              chartKey: 'graphModalChart',
              canvasId: 'graph-modal-canvas',
              canvasClass: 'graph-modal-canvas',
              expandable: false
            });
            state.graphModalChart?.resize();
          });
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

        const setOverallStatus = (workbenchModel) => {
          if (!overallStatus) {
            return;
          }

          overallStatus.textContent = workbenchModel.pageStateLabel;
          overallStatus.className = workbenchModel.pageStateTone === 'failed' ? 'status-chip failed' : 'status-chip';
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
          overallStatus.textContent = statusText('interrupted');
          overallStatus.className = 'status-chip failed';
          formMessage.textContent = '分析连接已中断，请重新开始分析。';
          formMessage.className = 'error';
          setLaunchControlsDisabled(false);

          if (!state.lastSession) {
            return;
          }

          const statuses = buildDerivedStages(state.lastSession);
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

          if (session?.status === 'completed' && hasStableWorkbenchResult(session)) {
            state.stableResultSession = cloneSession(session);
          }

          if (session) {
            state.acceptedSnapshotMeta = createSnapshotMeta(session);

            if (isLiveSessionTerminalStatus(session.status)) {
              state.lastTerminalSnapshotMeta = createSnapshotMeta(session);
            }
          }

          const displaySession = createDisplaySession(session, state.stableResultSession);
          state.displaySession = displaySession;
          setLaunchControlsDisabled(Boolean(session && (session.status === 'queued' || session.status === 'running')));

          if (session?.sessionId) {
            state.sessionId = session.sessionId;
            const importMode = session.source?.metadata?.importMode;
            const importStatus = session.source?.metadata?.importStatus;
            const cachedAt = session.source?.metadata?.cachedAt;
            const statusLabel = importStatus ? ' · 导入状态：' + formatImportStatusLabel(importStatus) : '';
            const cachedAtLabel = importStatus === 'cache' && cachedAt ? ' · 缓存时间：' + cachedAt : '';
            const retainedNote = displaySession && displaySession.sessionId === session.sessionId && hasRetainedWorkbenchResult(displaySession)
              ? session.status === 'failed'
                ? ' · 本轮失败，已保留上一版结果'
                : ' · 只有新结果成功返回后才替换当前工作台'
              : '';
            formMessage.textContent = importMode
              ? '当前 sessionId: ' + session.sessionId + ' · importMode=' + importMode + statusLabel + cachedAtLabel + retainedNote
              : '当前 sessionId: ' + session.sessionId + statusLabel + cachedAtLabel + retainedNote;
          }

          const workbenchModel = createLiveWorkbenchViewModel(displaySession, supportedSourceLabels);
          renderControlStrip(workbenchModel);
          setOverallStatus(workbenchModel);
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
            const session = await fetchJson('/demo/live/session/' + sessionId);

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

        const createSession = async (payload) => {
          formMessage.textContent = '正在创建分析任务...';
          formMessage.className = 'muted';
          setLaunchControlsDisabled(true);

          try {
            const responsePayload = await fetchJson('/demo/live/session', {
              method: 'POST',
              body: JSON.stringify(payload)
            });

            if (!responsePayload) {
              return;
            }

            startPolling(responsePayload.sessionId);
          } catch (error) {
            if (error?.status === 409 && error?.payload?.sessionId) {
              formMessage.textContent = '已有运行中的分析任务，已切回当前 session。';
              formMessage.className = 'muted';
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

        const bootstrap = async () => {
          applyInputMode(inputModeInput.value);
          updateView(null);

          try {
            const active = await fetchJson('/demo/live/session/active');

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

  router.get('/', (_request, response) => {
    applyNoStoreHeaders(response);
    response.status(200).type('html').send(renderLiveConsolePage(options.runtimeEnv));
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
