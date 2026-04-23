import { Router } from 'express';

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
  buildJudgments,
  createLiveWorkbenchViewModel,
  extractSentences,
  formatImportModeLabel,
  formatImportStatusLabel,
  getDisplayHeadline,
  getDisplaySourceTitle,
  getDisplaySource,
  getEntities,
  getGraphPresentationMode,
  getRelations,
  getSourceMetadata,
  getStepStatus,
  getSummary,
  getTotalPrice,
  inferEventType,
  inferImportance,
  isGeneratedSourceTitle
} from './live-workbench.js';
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

const renderLiveConsolePage = (runtimeEnv: RuntimeEnv): string => {
  const sample = demoCorpus[0];
  const presetCards = liveNewsPresets
    .map(
      (preset) => `
        <article
          class="preset-card card-detail-trigger"
          data-preset-id="${escapeHtml(preset.id)}"
          data-detail-kicker="预置样本"
          data-detail-title="${escapeHtml(preset.title)}"
          data-detail-subtitle="${escapeHtml(SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite])}"
          data-detail-body="${escapeHtml(preset.excerpt)}"
          data-detail-quote="${escapeHtml(preset.text.split('\n\n').slice(0, 2).join('\n\n'))}"
          data-detail-meta="${escapeHtml(JSON.stringify([
            SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite],
            new URL(preset.articleUrl).hostname,
            '已缓存导入结果'
          ]))}"
          tabindex="0"
          role="button"
        >
          <div class="preset-meta">
            <span>${escapeHtml(SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite])}</span>
            <span>${escapeHtml(new URL(preset.articleUrl).hostname)}</span>
          </div>
          <div class="card-detail-hint">点击查看详情</div>
          <h3>${escapeHtml(preset.title)}</h3>
          <p class="preset-excerpt">${escapeHtml(preset.excerpt)}</p>
          <p class="preset-snippet">${escapeHtml(preset.text.split('\n\n')[0])}</p>
          <button type="button" class="secondary preset-launch-button" data-preset-id="${escapeHtml(preset.id)}">使用本地缓存</button>
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
          grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.72fr);
          gap: 18px;
        }

        .input-panel {
          order: 2;
          position: sticky;
          top: 16px;
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

        .preset-grid {
          display: grid;
          gap: 12px;
          margin-top: 6px;
        }

        .preset-card {
          border-radius: 22px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.82);
          padding: 16px;
          display: grid;
          gap: 10px;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }

        .preset-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 28px rgba(31, 41, 55, 0.08);
          border-color: rgba(15, 118, 110, 0.24);
        }

        .preset-card h3 {
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

        .graph-canvas {
          width: 100%;
          min-height: 340px;
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

        .workbench-top p {
          margin: 0;
          color: var(--muted);
          line-height: 1.6;
        }

        .workbench-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.8fr);
          gap: 16px;
        }

        .workbench-main,
        .workbench-sidebar {
          display: grid;
          gap: 16px;
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
          line-height: 1.7;
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
          line-height: 1.65;
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
          font-size: 13px;
          color: var(--muted);
        }

        .credential-list .evidence-item {
          background: rgba(248, 250, 252, 0.92);
        }

        .detail-modal {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(15, 23, 42, 0.48);
          backdrop-filter: blur(8px);
          z-index: 20;
        }

        .detail-dialog {
          width: min(820px, 100%);
          max-height: min(80vh, 920px);
          overflow: auto;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 12rem),
            rgba(255, 251, 245, 0.98);
          box-shadow: 0 26px 60px rgba(15, 23, 42, 0.22);
          padding: 22px;
        }

        .detail-dialog-top {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }

        .detail-dialog-top h2 {
          margin: 0;
          font-size: clamp(1.5rem, 3vw, 2.2rem);
        }

        .detail-dialog-body {
          display: grid;
          gap: 14px;
          margin-top: 18px;
        }

        .detail-body {
          margin: 0;
          line-height: 1.75;
          color: var(--muted);
        }

        .detail-quote {
          margin: 0;
          padding: 16px 18px;
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.88);
          color: var(--ink);
          line-height: 1.75;
        }

        .detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
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
      </style>
    </head>
    <body>
      <main>
        <section class="hero">
          <div class="eyebrow"><span>资讯分析工作台</span><span>Mode ${escapeHtml(runtimeEnv.paymentMode)}</span></div>
          <h1>可信投研工作台</h1>
          <p>输入一条资讯后，页面会把事件判断、关键主体、证据摘录和关系图放进同一个工作区，方便在一屏内来回比对。</p>
          <p class="mode-note">支持白名单链接、手动正文和预置样本。导入状态：实时抓取 / 导入状态：缓存回退；图中的 derived 连边只用于辅助浏览，不代表真实抽取关系。</p>
        </section>

        <section class="layout">
          <article class="panel input-panel">
            <h2>分析入口</h2>
            <div class="input-grid">
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
                <input id="article-url-input" placeholder="https://wublock123.com/p/654321" />
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
                <h3>预置新闻卡片</h3>
                <p class="muted">卡片里内置了缓存导入结果。点击卡片可以先看摘要，再选择直接启动分析。</p>
              </section>
              <section class="preset-grid">${presetCards}</section>
            </div>
          </article>

          <article class="panel result-panel">
            <div class="workbench-top">
              <div>
                <h2>可信投研工作台</h2>
                <p>主区优先展示事件总览、关键判断和证据摘录；支付、receipt 与 payload 证据统一收纳到分析凭证区域，辅助关系图保留在次级信息层。</p>
              </div>
              <div id="overall-status" class="status-chip">waiting</div>
            </div>

            <section class="workbench-grid" aria-live="polite">
              <div class="workbench-main">
                <article id="overview-card" class="overview-card card-detail-trigger" tabindex="0" role="button">
                  <div class="section-kicker">事件总览</div>
                  <div class="card-detail-hint">点击查看完整摘要</div>
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
                    <p class="muted">每条判断都应回答“为什么重要”，而不是只复述原文。</p>
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
                    <p class="muted">当前展示相关原文片段，帮助人工复核判断；暂不宣称已完成逐句证据对齐。</p>
                  </div>
                  <div id="evidence-preview" class="evidence-list muted">尚无可回看的原文证据。</div>
                </section>
              </div>

              <aside class="workbench-sidebar">
                <article class="sidebar-card">
                  <div class="section-kicker">分析凭证</div>
                  <div id="credential-preview" class="credential-list muted">payment、receipt 与 payloadHash 会在这里统一展示。</div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">分析流程</div>
                  <div id="stage-grid" class="stage-grid"></div>
                </article>

                <article class="sidebar-card">
                  <div class="section-kicker">导入来源</div>
                  <div id="source-preview" class="source-list">
                    <p class="source-note">支持白名单链接、手动文本与预置样本。导入边界会在这里明确展示。</p>
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
              </aside>
            </section>
          </article>
        </section>

        <div id="detail-modal" class="detail-modal hidden" aria-hidden="true">
          <div class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
            <div class="detail-dialog-top">
              <div>
                <div id="detail-modal-kicker" class="section-kicker">详情</div>
                <h2 id="detail-modal-title">卡片详情</h2>
                <p id="detail-modal-subtitle" class="mode-note">点击卡片后，这里会展示完整内容与相关上下文。</p>
              </div>
              <button id="detail-modal-close" class="secondary" type="button">关闭</button>
            </div>
            <div class="detail-dialog-body">
              <p id="detail-modal-body" class="detail-body"></p>
              <blockquote id="detail-modal-quote" class="detail-quote hidden"></blockquote>
              <div id="detail-modal-meta" class="detail-meta"></div>
            </div>
          </div>
        </div>
      </main>

      <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
      <script>
        const sample = ${JSON.stringify(sample)};
        const presets = ${JSON.stringify(liveNewsPresets)};
        const supportedSourceLabels = ${JSON.stringify(SUPPORTED_NEWS_SOURCE_LABELS)};
        const state = {
          pollingTimer: null,
          sessionId: null,
          graphChart: null,
          lastSession: null
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
        const stageGrid = document.getElementById('stage-grid');
        const overallStatus = document.getElementById('overall-status');
        const overviewCard = document.getElementById('overview-card');
        const eventHeadline = document.getElementById('event-headline');
        const eventSummary = document.getElementById('event-summary');
        const eventMetrics = document.getElementById('event-metrics');
        const judgmentList = document.getElementById('judgment-list');
        const evidencePreview = document.getElementById('evidence-preview');
        const sourcePreview = document.getElementById('source-preview');
        const entityPreview = document.getElementById('entity-preview');
        const credentialPreview = document.getElementById('credential-preview');
        const graphPreview = document.getElementById('graph-preview');
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
        const detailModal = document.getElementById('detail-modal');
        const detailModalClose = document.getElementById('detail-modal-close');
        const detailModalKicker = document.getElementById('detail-modal-kicker');
        const detailModalTitle = document.getElementById('detail-modal-title');
        const detailModalSubtitle = document.getElementById('detail-modal-subtitle');
        const detailModalBody = document.getElementById('detail-modal-body');
        const detailModalQuote = document.getElementById('detail-modal-quote');
        const detailModalMeta = document.getElementById('detail-modal-meta');

        window.addEventListener('resize', () => {
          if (state.graphChart) {
            state.graphChart.resize();
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
        ${buildJudgments.toString()}
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

        const closeDetailModal = () => {
          if (!detailModal) {
            return;
          }

          detailModal.classList.add('hidden');
          detailModal.setAttribute('aria-hidden', 'true');
        };

        const openDetailModal = (payload) => {
          if (!detailModal || !detailModalTitle || !detailModalSubtitle || !detailModalBody || !detailModalQuote || !detailModalMeta || !detailModalKicker) {
            return;
          }

          const metaEntries = (() => {
            try {
              return JSON.parse(String(payload.meta ?? '[]'));
            } catch {
              return [];
            }
          })();

          detailModalKicker.textContent = payload.kicker || '卡片详情';
          detailModalTitle.textContent = payload.title || '未命名卡片';
          detailModalSubtitle.textContent = payload.subtitle || '完整内容与相关上下文';
          detailModalBody.textContent = payload.body || '暂无更多说明。';
          detailModalQuote.textContent = payload.quote || '';
          detailModalQuote.classList.toggle('hidden', !payload.quote);
          detailModalMeta.innerHTML = metaEntries
            .map((entry) => \`<span class="meta-pill">\${escapeText(String(entry))}</span>\`)
            .join('');
          detailModal.classList.remove('hidden');
          detailModal.setAttribute('aria-hidden', 'false');
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
            overviewCard.setAttribute('data-detail-kicker', '事件总览');
            overviewCard.setAttribute('data-detail-title', workbenchModel.headline);
            overviewCard.setAttribute('data-detail-subtitle', '完整摘要');
            overviewCard.setAttribute('data-detail-body', workbenchModel.fullSummary || workbenchModel.briefing);
            overviewCard.setAttribute('data-detail-quote', '');
            overviewCard.setAttribute(
              'data-detail-meta',
              JSON.stringify([
                workbenchModel.eventTypeValue,
                '重要性 ' + workbenchModel.importanceValue,
                workbenchModel.sourceModeValue
              ])
            );
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
            .map((judgment) => \`
              <article
                class="judgment-card card-detail-trigger"
                data-detail-kicker="\${escapeText(judgment.kicker)}"
                data-detail-title="\${escapeText(judgment.title)}"
                data-detail-subtitle="关键判断详情"
                data-detail-body="\${escapeText(judgment.body)}"
                data-detail-quote="\${escapeText(judgment.evidenceQuote)}"
                data-detail-meta="\${escapeText(JSON.stringify(judgment.meta))}"
                tabindex="0"
                role="button"
              >
                <div class="section-kicker">\${escapeText(judgment.kicker)}</div>
                <div class="card-detail-hint">点击查看详情</div>
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
                data-detail-kicker="证据摘录 \${index + 1}"
                data-detail-title="\${escapeText(judgment.evidenceTitle)}"
                data-detail-subtitle="\${escapeText(workbenchModel.sourceLabel)}"
                data-detail-body="\${escapeText(judgment.evidenceRoleLine)}"
                data-detail-quote="\${escapeText(judgment.evidenceQuote)}"
                data-detail-meta="\${escapeText(JSON.stringify(
                  [
                    '来源：' + workbenchModel.sourceLabel,
                    workbenchModel.importStatusLabel !== '未标记导入状态' ? workbenchModel.importStatusLabel : ''
                  ].filter(Boolean)
                ))}"
                tabindex="0"
                role="button"
              >
                <div class="section-kicker">摘录 \${index + 1}</div>
                <div class="card-detail-hint">点击查看详情</div>
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

        const renderSource = (session, workbenchModel) => {
          if (!session) {
            sourcePreview.innerHTML = '<p class="source-note">支持白名单链接、手动文本与预置样本。导入边界会在这里明确展示。</p>';
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
                \${renderCopyableField('payloadHash', step.payloadHash ?? 'n/a')}
                \${renderCopyableField(
                  'receiptTxHash',
                  step.receiptTxHash ?? 'n/a',
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

        const disposeGraphChart = () => {
          if (state.graphChart) {
            state.graphChart.dispose();
            state.graphChart = null;
          }
        };

        const renderGraphList = (nodes, edges) => {
          disposeGraphChart();
          graphPreview.innerHTML = \`
            <div class="stage-label">辅助关系图</div>
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
            <p class="muted">当前主体或关系不足以稳定成图，已自动降级为清单视图；最终判断仍以证据区为准。</p>
          \`;
        };

        const renderGraph = (session) => {
          if (!session?.agentSession?.graph) {
            disposeGraphChart();
            graphPreview.innerHTML = '<p class="muted">辅助关系图会在摘要、主体和关系补齐后出现，弱数据场景会自动降级为清单视图。</p>';
            return;
          }

          const nodes = session.agentSession.graph.nodes ?? [];
          const edges = session.agentSession.graph.edges ?? [];
          const graphMode = getGraphPresentationMode(session);

          if (graphMode === 'list') {
            renderGraphList(nodes, edges);
            return;
          }

          if (graphMode === 'empty') {
            disposeGraphChart();
            graphPreview.innerHTML = '<p class="muted">辅助关系图会在摘要、主体和关系补齐后出现，弱数据场景会自动降级为清单视图。</p>';
            return;
          }

          graphPreview.innerHTML = \`
            <div class="stage-label">辅助关系图</div>
            <div id="graph-canvas" class="graph-canvas" role="img" aria-label="Auxiliary relationship graph"></div>
            <p class="muted">滚轮缩放，拖动画布可查看细节。graphUrl: \${escapeText(session.graphUrl ?? 'n/a')} · derived 边仅用于展示连通性，最终判断以证据区为准。</p>
          \`;

          const graphCanvas = document.getElementById('graph-canvas');

          if (!graphCanvas || !window.echarts) {
            renderGraphList(nodes, edges);
            return;
          }

          disposeGraphChart();
          state.graphChart = window.echarts.init(graphCanvas, null, { renderer: 'svg' });
          state.graphChart.setOption({
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

        const renderStages = (session) => {
          const statuses = buildDerivedStages(session);
          stageGrid.innerHTML = stageOrder.map((key) => \`
            <article class="stage-card" data-status="\${statuses[key]}">
              <div class="stage-label">\${stageLabels[key]}</div>
              <div class="stage-status">\${statusText(statuses[key])}</div>
            </article>
          \`).join('');
        };

        const setOverallStatus = (session) => {
          const value = session?.status ?? 'waiting';
          overallStatus.textContent = statusText(value);
          overallStatus.className = value === 'failed' ? 'status-chip failed' : 'status-chip';
        };

        const stopPolling = () => {
          if (state.pollingTimer) {
            clearInterval(state.pollingTimer);
            state.pollingTimer = null;
          }
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

          const workbenchModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);
          setOverallStatus(session);
          renderCredentials(session);
          renderStages(session);
          renderEventOverview(session, workbenchModel);
          renderJudgments(workbenchModel);
          renderEvidenceDeck(workbenchModel);
          renderSource(session, workbenchModel);
          renderEntities(workbenchModel);
          renderGraph(session);

          if (!session || session.status === 'completed' || session.status === 'failed') {
            stopPolling();
          }
        };

        const fetchJson = async (path, options) => {
          const response = await fetch(path, {
            headers: { 'content-type': 'application/json' },
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

            if (session) {
              updateView(session);
              return;
            }

            setInterruptedState();
            stopPolling();
          } catch (error) {
            formMessage.textContent = error.message;
            formMessage.className = 'error';
            setInterruptedState();
            stopPolling();
          }
        };

        const startPolling = (sessionId) => {
          stopPolling();
          state.sessionId = sessionId;
          void pollSession(sessionId);
          state.pollingTimer = window.setInterval(() => {
            void pollSession(sessionId);
          }, 1000);
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

        if (detailModal) {
          detailModal.addEventListener('click', (event) => {
            if (event.target === detailModal || event.target === detailModalClose) {
              closeDetailModal();
            }
          });
        }

        document.addEventListener('click', (event) => {
          const target = event.target;
          const trigger = target instanceof Element ? target.closest('.card-detail-trigger') : null;

          if (!trigger) {
            return;
          }

          if (target instanceof Element && target.closest('.preset-launch-button, .copy-button, a')) {
            return;
          }

          openDetailModal({
            kicker: trigger.getAttribute('data-detail-kicker'),
            title: trigger.getAttribute('data-detail-title'),
            subtitle: trigger.getAttribute('data-detail-subtitle'),
            body: trigger.getAttribute('data-detail-body'),
            quote: trigger.getAttribute('data-detail-quote'),
            meta: trigger.getAttribute('data-detail-meta')
          });
        });

        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            closeDetailModal();
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
          openDetailModal({
            kicker: trigger.getAttribute('data-detail-kicker'),
            title: trigger.getAttribute('data-detail-title'),
            subtitle: trigger.getAttribute('data-detail-subtitle'),
            body: trigger.getAttribute('data-detail-body'),
            quote: trigger.getAttribute('data-detail-quote'),
            meta: trigger.getAttribute('data-detail-meta')
          });
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
    const session = await options.liveSessionService.readLatestSession();

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  router.get('/session/active', async (_request, response) => {
    const session = await options.liveSessionService.readActiveSession();

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  router.get('/session/:sessionId', async (request, response) => {
    const session = await options.liveSessionService.readSession(request.params.sessionId);

    if (!session) {
      response.status(404).json({ error: 'live_session_not_found' });
      return;
    }

    response.status(200).json(session);
  });

  return router;
};
