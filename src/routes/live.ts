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
import { getArcExplorerBaseUrl } from '../support/arc-explorer.js';

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

  const normalizedMetadata: SourceMetadata = {
    ...(articleUrl ? { articleUrl } : {}),
    ...(sourceSite ? { sourceSite: sourceSite as SupportedNewsSite } : {}),
    ...(importMode ? { importMode: importMode as SourceImportMode } : {})
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

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return '新闻导入失败。';
};

const renderLiveConsolePage = (runtimeEnv: RuntimeEnv): string => {
  const sample = demoCorpus[0];
  const presetCards = liveNewsPresets
    .map(
      (preset) => `
        <article class="preset-card" data-preset-id="${escapeHtml(preset.id)}">
          <div class="preset-meta">
            <span>${escapeHtml(SUPPORTED_NEWS_SOURCE_LABELS[preset.sourceSite])}</span>
            <span>${escapeHtml(new URL(preset.articleUrl).hostname)}</span>
          </div>
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
      <title>Live Agent Console</title>
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
        }

        .hero {
          padding: 26px;
          margin-bottom: 18px;
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
          grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
          gap: 18px;
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
        }

        .preset-card h3 {
          margin: 0;
          font-size: 18px;
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

        .graph-preview {
          margin-top: 18px;
          border-radius: 22px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.82);
          min-height: 260px;
          padding: 18px;
        }

        .graph-preview svg {
          width: 100%;
          height: auto;
          display: block;
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

        @media (max-width: 940px) {
          .layout {
            grid-template-columns: 1fr;
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
          <div class="eyebrow"><span>Live Agent Console</span><span>Mode ${escapeHtml(runtimeEnv.paymentMode)}</span></div>
          <h1>知识图谱 Live Console</h1>
          <p>支持两种输入模式：文章链接 或 手动文本。链接模式会先导入白名单新闻源，预置新闻卡片则直接使用本地缓存结果，不依赖实时抓远端网页。当前服务端模式为 <strong>${escapeHtml(runtimeEnv.paymentMode)}</strong>。</p>
        </section>

        <section class="layout">
          <article class="panel">
            <h2>输入区</h2>
            <div class="input-grid">
              <label>
                输入模式
                <select id="input-mode-input">
                  <option value="link" selected>文章链接</option>
                  <option value="manual">手动文本</option>
                </select>
              </label>
              <p class="mode-note">支持站点：${escapeHtml(Object.values(SUPPORTED_NEWS_SOURCE_LABELS).join(' / '))}。链接模式会提交到 /demo/live/session 并先执行导入。</p>

              <label id="article-url-field">
                文章链接
                <input id="article-url-input" placeholder="https://wublock123.com/p/654321" />
              </label>

              <div id="manual-fields" class="hidden">
                <div class="input-grid">
                  <label>
                    标题
                    <input id="title-input" value="${escapeHtml(sample.title ?? '')}" />
                  </label>
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
                <button id="start-button" class="primary" type="button">开始演示</button>
                <button id="fill-sample-button" class="secondary" type="button">填充示例</button>
              </div>
              <p id="form-message" class="muted">页面加载后会尝试恢复最近一次 live session。</p>

              <section class="section-heading">
                <h3>预置新闻卡片</h3>
                <p class="muted">卡片里内置了缓存导入结果，点击后会直接以 text + metadata.importMode="preset" 创建 live session。</p>
              </section>
              <section class="preset-grid">${presetCards}</section>
            </div>
          </article>

          <article class="panel">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;">
              <div>
                <h2 style="margin-bottom:6px;">运行状态</h2>
                <p class="muted" style="margin-top:0;">固定展示 create → summary → entities → relations → graph。</p>
              </div>
              <div id="overall-status" class="status-chip">waiting</div>
            </div>

            <section id="stage-grid" class="stage-grid" aria-live="polite"></section>

            <section class="evidence-grid" aria-live="polite">
              <article class="evidence-card">
                <div class="stage-label">Summary</div>
                <p id="summary-preview" class="muted">尚未生成</p>
              </article>
              <article class="evidence-card">
                <div class="stage-label">Evidence</div>
                <div id="evidence-preview" class="evidence-list muted">尚无支付证据</div>
              </article>
            </section>

            <section id="graph-preview" class="graph-preview" aria-live="polite">
              <p class="muted">最终图谱会显示在这里。</p>
            </section>
          </article>
        </section>
      </main>

      <script>
        const sample = ${JSON.stringify(sample)};
        const presets = ${JSON.stringify(liveNewsPresets)};
        const state = {
          pollingTimer: null,
          sessionId: null
        };
        const stageOrder = ['create', 'summary', 'entities', 'relations', 'graph'];
        const stageLabels = {
          create: 'Create',
          summary: 'Summary',
          entities: 'Entities',
          relations: 'Relations',
          graph: 'Graph'
        };
        const stageGrid = document.getElementById('stage-grid');
        const overallStatus = document.getElementById('overall-status');
        const summaryPreview = document.getElementById('summary-preview');
        const evidencePreview = document.getElementById('evidence-preview');
        const graphPreview = document.getElementById('graph-preview');
        const explorerBaseUrl = ${JSON.stringify(getArcExplorerBaseUrl(runtimeEnv))};
        const formMessage = document.getElementById('form-message');
        const inputModeInput = document.getElementById('input-mode-input');
        const articleUrlField = document.getElementById('article-url-field');
        const articleUrlInput = document.getElementById('article-url-input');
        const manualFields = document.getElementById('manual-fields');
        const titleInput = document.getElementById('title-input');
        const sourceTypeInput = document.getElementById('source-type-input');
        const textInput = document.getElementById('text-input');
        const startButton = document.getElementById('start-button');
        const fillSampleButton = document.getElementById('fill-sample-button');
        const presetButtons = document.querySelectorAll('.preset-launch-button');

        const statusText = (status) => {
          if (!status) return 'pending';
          return status;
        };

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

        const getStep = (session, key) => session?.steps?.find((step) => step.key === key);

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
            summary: getStep(session, 'summary')?.status ?? 'pending',
            entities: getStep(session, 'entities')?.status ?? 'pending',
            relations: getStep(session, 'relations')?.status ?? 'pending',
            graph: graphStatus
          };
        };

        const renderGraph = (session) => {
          if (!session?.agentSession?.graph) {
            graphPreview.innerHTML = '<p class="muted">最终图谱会显示在这里。</p>';
            return;
          }

          const nodes = session.agentSession.graph.nodes;
          const edges = session.agentSession.graph.edges
            .map((edge) => {
              const source = nodes.find((node) => node.id === edge.source);
              const target = nodes.find((node) => node.id === edge.target);

              if (!source || !target) {
                return '';
              }

              const labelX = Math.round((source.x + target.x) / 2);
              const labelY = Math.round((source.y + target.y) / 2);

              return \`
                <line x1="\${source.x}" y1="\${source.y}" x2="\${target.x}" y2="\${target.y}" stroke="#94a3b8" stroke-width="2" />
                <text x="\${labelX}" y="\${labelY - 8}" text-anchor="middle" fill="#334155" font-size="12">\${escapeText(edge.label)}</text>
              \`;
            })
            .join('');
          const circles = nodes
            .map((node) => \`
              <g>
                <circle cx="\${node.x}" cy="\${node.y}" r="26" fill="\${escapeText(node.color)}" opacity="0.92"></circle>
                <text x="\${node.x}" y="\${node.y + 42}" text-anchor="middle" fill="#0f172a" font-size="13">\${escapeText(node.label)}</text>
              </g>
            \`)
            .join('');

          graphPreview.innerHTML = \`
            <div class="stage-label">graph-preview</div>
            <svg viewBox="0 0 480 440" role="img" aria-label="Knowledge graph">
              <rect x="0" y="0" width="480" height="440" rx="24" fill="#f8fafc"></rect>
              \${edges}
              \${circles}
            </svg>
            <p class="muted">graphUrl: \${escapeText(session.graphUrl ?? 'n/a')}</p>
          \`;
        };

        const renderEvidence = (session) => {
          if (!session) {
            summaryPreview.textContent = '尚未生成';
            evidencePreview.textContent = '尚无支付证据';
            renderGraph(null);
            return;
          }

          summaryPreview.textContent = session.preview?.summary ?? '摘要生成中';
          const runs = session.agentSession?.runs ?? [];
          evidencePreview.innerHTML = runs.length > 0
            ? runs.map((run) => \`
                <article class="evidence-item">
                  <h3>\${escapeText(run.operation)}</h3>
                  \${renderCopyableField('requestId', run.requestId)}
                  \${renderCopyableField('paymentTransaction', run.paymentTransaction)}
                  \${renderCopyableField(
                    'paymentPayer',
                    run.paymentPayer,
                    isHexAddress(run.paymentPayer)
                      ? {
                          explorerUrl: explorerBaseUrl + '/address/' + run.paymentPayer,
                          explorerLabel: '地址'
                        }
                      : {}
                  )}
                  \${renderCopyableField(
                    'receiptTxHash',
                    run.receiptTxHash ?? 'n/a',
                    isHexTransactionHash(run.receiptTxHash)
                      ? {
                          explorerUrl: explorerBaseUrl + '/tx/' + run.receiptTxHash,
                          explorerLabel: '链上交易'
                        }
                      : {}
                  )}
                </article>
              \`).join('')
            : '尚无支付证据';
          renderGraph(session);
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
          overallStatus.textContent = value;
          overallStatus.className = value === 'failed' ? 'status-chip failed' : 'status-chip';
        };

        const stopPolling = () => {
          if (state.pollingTimer) {
            clearInterval(state.pollingTimer);
            state.pollingTimer = null;
          }
        };

        const updateView = (session) => {
          if (session?.sessionId) {
            state.sessionId = session.sessionId;
            const importMode = session.source?.metadata?.importMode;
            formMessage.textContent = importMode
              ? '当前 sessionId: ' + session.sessionId + ' · importMode=' + importMode
              : '当前 sessionId: ' + session.sessionId;
          }

          setOverallStatus(session);
          renderStages(session);
          renderEvidence(session);

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
            }
          } catch (error) {
            formMessage.textContent = error.message;
            formMessage.className = 'error';
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
          formMessage.textContent = '正在创建 live session...';
          formMessage.className = 'muted';

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
            const message = error?.payload?.sessionId
              ? error.message + ' sessionId=' + error.payload.sessionId
              : error.message;
            formMessage.textContent = message;
            formMessage.className = 'error';
          }
        };

        fillSampleButton.addEventListener('click', () => {
          inputModeInput.value = 'manual';
          applyInputMode('manual');
          titleInput.value = sample.title ?? '';
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
                title: titleInput.value,
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
            titleInput.value = preset.request.title ?? '';
            sourceTypeInput.value = preset.request.sourceType;
            textInput.value = preset.request.text;
            await createSession(preset.request);
          });
        }

        const bootstrap = async () => {
          applyInputMode(inputModeInput.value);
          renderStages(null);

          try {
            const latest = await fetchJson('/demo/live/session/latest');

            if (latest) {
              updateView(latest);

              if (latest.status === 'queued' || latest.status === 'running') {
                startPolling(latest.sessionId);
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
              const importedArticle = await options.newsImporter.import(parsedBody.articleUrl);

              return {
                title: importedArticle.title,
                text: importedArticle.text,
                sourceType: importedArticle.sourceType,
                metadata: {
                  articleUrl: importedArticle.sourceUrl,
                  sourceSite: importedArticle.sourceSite,
                  importMode: 'link'
                } satisfies SourceMetadata
              };
            } catch (error) {
              response.status(400).json({
                error: 'news_import_failed',
                message: extractErrorMessage(error)
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
      response.status(409).json({
        error: 'live_session_active',
        sessionId: result.session.sessionId
      });
      return;
    }

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
