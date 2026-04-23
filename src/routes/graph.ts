import { Router } from 'express';

import type { AgentSession } from '../demo/agent-graph.js';
import type { RuntimeEnv } from '../config/env.js';
import type { SourceMetadata } from '../domain/extraction/types.js';
import type { FileAgentGraphStore } from '../store/agent-graph-store.js';

type CreateGraphRouterOptions = {
  agentGraphStore: FileAgentGraphStore;
  runtimeEnv: RuntimeEnv;
};

const LIVE_BRAND_LOGO_URL = '/demo/live/brand/logo.png';

const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const truncateMiddle = (value: string, head = 14, tail = 10): string => {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const renderEvidenceField = (
  label: string,
  value: string,
  options: {
    explorerUrl?: string;
    explorerLabel?: string;
  } = {}
): string => {
  return `
    <div class="evidence-field">
      <div class="evidence-label">${escapeHtml(label)}</div>
      <div class="evidence-value" title="${escapeHtml(value)}">${escapeHtml(truncateMiddle(value))}</div>
      ${options.explorerUrl ? `<a class="explorer-link" href="${escapeHtml(options.explorerUrl)}" target="_blank" rel="noreferrer">${escapeHtml(options.explorerLabel ?? '浏览器')}</a>` : ''}
      ${value === 'n/a' ? '' : `<button type="button" class="copy-button" data-copy-value="${escapeHtml(value)}" onclick="copyField(this)">复制</button>`}
    </div>
  `;
};

const formatImportMode = (importMode: string): string => {
  switch (importMode) {
    case 'manual':
      return '手动文本 (manual)';
    case 'link':
      return '文章链接 (link)';
    case 'preset':
      return '预置卡片 (preset)';
    default:
      return importMode;
  }
};

const formatImportStatus = (importStatus: SourceMetadata['importStatus']): string => {
  switch (importStatus) {
    case 'cache':
      return '缓存回退';
    case 'live':
    default:
      return '实时抓取';
  }
};

const renderSourceMetadata = (session: AgentSession): string => {
  const metadata = session.source.metadata;

  if (!metadata) {
    return `
      <div class="meta-card source-card">
        <strong>来源信息</strong>
        <p>未记录来源信息</p>
        <p class="summary">这个 session 来自旧版本产物，source metadata 不存在时页面会保持兼容展示。</p>
      </div>
    `;
  }

  return `
    <div class="meta-card source-card">
      <strong>来源信息</strong>
      ${renderEvidenceField(
        'articleUrl',
        metadata.articleUrl ?? 'n/a',
        metadata.articleUrl
          ? {
              explorerUrl: metadata.articleUrl,
              explorerLabel: '原文'
            }
          : {}
      )}
      ${renderEvidenceField('sourceSite', metadata.sourceSite ?? 'n/a')}
      ${renderEvidenceField('importMode', metadata.importMode ? formatImportMode(metadata.importMode) : 'n/a')}
      ${renderEvidenceField('importStatus', metadata.importStatus ? formatImportStatus(metadata.importStatus) : 'n/a')}
      ${renderEvidenceField('cachedAt', metadata.cachedAt ?? 'n/a')}
      ${renderEvidenceField('title', session.source.title ?? 'n/a')}
    </div>
  `;
};

const renderGraphPage = (session: AgentSession): string => {
  const graphNodes = JSON.stringify(
    session.graph.nodes.map((node) => ({
      id: node.id,
      name: node.label,
      value: node.type,
      x: node.x,
      y: node.y,
      symbolSize: 52,
      itemStyle: {
        color: node.color
      }
    }))
  );
  const graphLinks = JSON.stringify(
    session.graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      value: edge.label,
      lineStyle: {
        type: edge.provenance === 'derived' ? 'dashed' : 'solid',
        opacity: edge.provenance === 'derived' ? 0.54 : 0.88
      }
    }))
  );
  const relationList = session.relations.length > 0
    ? session.relations
        .map((relation) => `<li>${escapeHtml(relation.source)} ${escapeHtml(relation.relation)} ${escapeHtml(relation.target)}</li>`)
        .join('')
    : '<li>当前关系较弱，建议回到 Desk 结合核心结论与证据锚点继续复核。</li>';

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>关系导航 ${escapeHtml(session.sessionId)}</title>
      <link rel="icon" type="image/png" href="${LIVE_BRAND_LOGO_URL}" />
      <link rel="shortcut icon" type="image/png" href="${LIVE_BRAND_LOGO_URL}" />
      <style>
        :root {
          color-scheme: dark;
          --bg: #050912;
          --panel: rgba(10, 16, 27, 0.92);
          --border: rgba(140, 198, 255, 0.14);
          --text: #edf4fb;
          --muted: #93a4b8;
          --accent: #86e7d4;
          --gold: #d6a96c;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif;
          color: var(--text);
          background:
            radial-gradient(circle at 12% 0%, rgba(140, 198, 255, 0.16), transparent 26rem),
            radial-gradient(circle at 86% 10%, rgba(134, 231, 212, 0.12), transparent 20rem),
            linear-gradient(180deg, #07101b 0%, var(--bg) 60%);
        }

        main {
          max-width: 1320px;
          margin: 0 auto;
          padding: 24px 20px 56px;
        }

        .hero, .panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: 0 24px 50px rgba(2, 8, 23, 0.34);
        }

        .hero {
          padding: 24px;
          margin-bottom: 20px;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
        }

        .brand-mark {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.72);
        }

        .brand-mark img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .brand-copy {
          display: grid;
          gap: 2px;
        }

        .brand-wordmark {
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: -0.03em;
        }

        .brand-subtitle {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .eyebrow {
          color: var(--accent);
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .summary {
          color: var(--muted);
          font-size: 16px;
          line-height: 1.7;
          max-width: 76ch;
        }

        .return-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 12px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          text-decoration: none;
        }

        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.28fr) minmax(300px, 0.72fr);
          gap: 20px;
          align-items: start;
        }

        .panel {
          padding: 24px;
        }

        .graph-header,
        .side-stack {
          display: grid;
          gap: 12px;
        }

        .graph-header h2,
        .side-stack h2,
        h1 {
          margin: 0;
        }

        .graph-surface {
          border-radius: 24px;
          border: 1px solid rgba(140, 198, 255, 0.14);
          background:
            radial-gradient(circle at 16% 18%, rgba(140, 198, 255, 0.16), transparent 10rem),
            radial-gradient(circle at 84% 12%, rgba(134, 231, 212, 0.12), transparent 10rem),
            linear-gradient(180deg, rgba(7, 13, 24, 0.94), rgba(5, 9, 18, 0.92));
          min-height: 560px;
          padding: 18px;
          position: relative;
          overflow: hidden;
        }

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

        .graph-surface > * {
          position: relative;
          z-index: 1;
        }

        .graph-canvas {
          width: 100%;
          min-height: 520px;
        }

        .hint-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .graph-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .hint-pill {
          display: inline-flex;
          align-items: center;
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          font-size: 13px;
        }

        .relation-list {
          margin: 0;
          padding-left: 18px;
          color: var(--muted);
          line-height: 1.7;
        }

        .meta-card {
          background: rgba(248, 250, 252, 0.92);
          border: 1px solid rgba(148, 163, 184, 0.26);
          border-radius: 18px;
          padding: 16px;
        }

        .source-card {
          display: grid;
          gap: 10px;
        }

        .evidence-field {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          margin-bottom: 10px;
        }

        .evidence-label {
          grid-column: 1 / -1;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent);
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

        .copy-button,
        .explorer-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          font-size: 13px;
          cursor: pointer;
          text-decoration: none;
        }

        .graph-zoom-label {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 64px;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(140, 198, 255, 0.18);
          background: rgba(5, 11, 20, 0.82);
          color: var(--text);
          font-family: "SFMono-Regular", "Menlo", monospace;
          font-size: 12px;
          letter-spacing: 0.06em;
        }

        .copy-button:disabled {
          opacity: 0.7;
          cursor: default;
        }

        @media (max-width: 980px) {
          .layout {
            grid-template-columns: 1fr;
          }

          .graph-surface {
            min-height: 420px;
          }

          .graph-canvas {
            min-height: 380px;
          }
        }
      </style>
    </head>
    <body>
      <main>
        <section class="hero">
          <div class="brand-row">
            <div class="brand-mark" aria-hidden="true">
              <img src="${LIVE_BRAND_LOGO_URL}" alt="" />
            </div>
            <div class="brand-copy">
              <div class="brand-wordmark">Arc</div>
              <div class="brand-subtitle">The Economic OS</div>
            </div>
          </div>
          <div class="eyebrow">关系导航器</div>
          <h1>${escapeHtml(session.source.title ?? session.sessionId)}</h1>
          <p class="summary">独立 graph 页面只负责关系导航，不承担结果主阅读。需要完整结论时，请回到 Arc Signal Desk 沿“执行摘要 -> 核心结论 -> 证据锚点”继续查看。</p>
          <a class="return-link" href="/demo/live">返回 Arc Signal Desk</a>
        </section>

        <section class="layout">
          <article class="panel">
            <div class="graph-header">
              <div class="eyebrow">关系导航</div>
              <h2>关系画布</h2>
              <p class="summary">使用 ECharts 渲染，支持滚轮缩放与拖动画布。derived 仅用于浏览连通性，不代表真实抽取关系。</p>
              <div class="graph-toolbar" aria-label="图谱缩放控制">
                <button type="button" class="copy-button" data-graph-zoom="out" aria-label="缩小图谱">-</button>
                <span id="graph-zoom-label" class="graph-zoom-label">100%</span>
                <button type="button" class="copy-button" data-graph-zoom="in" aria-label="放大图谱">+</button>
                <button type="button" class="copy-button" data-graph-zoom="reset" aria-label="重置图谱">重置</button>
              </div>
              <div class="hint-row">
                <span class="hint-pill">滚轮缩放</span>
                <span class="hint-pill">拖动画布</span>
                <span class="hint-pill">derived 仅用于浏览连通性，不代表真实抽取关系</span>
              </div>
            </div>
            <div class="graph-surface">
              <div id="graph-canvas" class="graph-canvas" role="img" aria-label="knowledge graph"></div>
            </div>
          </article>

          <article class="panel">
            <div class="side-stack">
              <div>
                <div class="eyebrow">导航说明</div>
                <h2>连接清单</h2>
                <ul class="relation-list">
                  ${relationList}
                </ul>
              </div>
              <div>
                <div class="eyebrow">来源元信息</div>
                <h2>来源信息</h2>
                ${renderSourceMetadata(session)}
              </div>
            </div>
          </article>
        </section>

        <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
        <script>
          const graphNodes = ${graphNodes};
          const graphLinks = ${graphLinks};

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

          const graphCanvas = document.getElementById('graph-canvas');
          const graphZoomLabel = document.getElementById('graph-zoom-label');
          const graphZoomStep = 0.15;
          const graphZoomMin = 0.7;
          const graphZoomMax = 2.4;
          let chart = null;
          let graphZoom = 1;

          const clampGraphZoom = (value) => Math.min(graphZoomMax, Math.max(graphZoomMin, value));
          const syncGraphZoomLabel = () => {
            if (graphZoomLabel) {
              graphZoomLabel.textContent = Math.round(graphZoom * 100) + '%';
            }
          };

          const updateGraphZoom = (nextZoom) => {
            graphZoom = clampGraphZoom(nextZoom);
            syncGraphZoomLabel();

            if (!chart) {
              return;
            }

            chart.setOption({
              series: [
                {
                  id: 'relationship-graph',
                  zoom: graphZoom
                }
              ]
            });
          };

          const renderGraph = () => {
            if (!graphCanvas || !window.echarts || graphNodes.length === 0) {
              return;
            }

            chart = window.echarts.init(graphCanvas, null, { renderer: 'svg' });
            chart.setOption({
              animationDuration: 420,
              tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(5, 11, 20, 0.94)',
                borderColor: 'rgba(140, 198, 255, 0.22)',
                textStyle: {
                  color: '#edf4fb',
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
                    backgroundColor: 'rgba(5, 11, 20, 0.82)',
                    padding: [6, 10],
                    borderRadius: 999,
                    textBorderColor: 'rgba(2, 6, 23, 0.92)',
                    textBorderWidth: 6,
                    shadowColor: 'rgba(2, 8, 23, 0.22)',
                    shadowBlur: 18
                  },
                  edgeLabel: {
                    show: true,
                    formatter: ({ data }) => data.value,
                    color: '#dbeafe',
                    fontSize: 12,
                    fontWeight: 700,
                    backgroundColor: 'rgba(5, 11, 20, 0.84)',
                    padding: [4, 8],
                    borderRadius: 999,
                    textBorderColor: 'rgba(2, 6, 23, 0.92)',
                    textBorderWidth: 4,
                    shadowColor: 'rgba(2, 8, 23, 0.16)',
                    shadowBlur: 12
                  },
                  lineStyle: {
                    color: '#8cc6ff',
                    width: 2.6,
                    curveness: 0.08
                  },
                  emphasis: {
                    focus: 'adjacency'
                  },
                  data: graphNodes,
                  links: graphLinks
                }
              ]
            });

            chart.on('graphRoam', () => {
              const currentZoom = Number(chart?.getOption?.()?.series?.[0]?.zoom ?? graphZoom);
              graphZoom = clampGraphZoom(currentZoom);
              syncGraphZoomLabel();
            });

            syncGraphZoomLabel();
          };

          document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-graph-zoom]') : null;

            if (!target) {
              return;
            }

            const zoomAction = target.getAttribute('data-graph-zoom');

            if (zoomAction === 'in') {
              updateGraphZoom(graphZoom + graphZoomStep);
            } else if (zoomAction === 'out') {
              updateGraphZoom(graphZoom - graphZoomStep);
            } else {
              updateGraphZoom(1);
            }
          });

          window.addEventListener('resize', () => {
            if (chart) {
              chart.resize();
            }
          });

          window.copyField = copyField;
          renderGraph();
        </script>
      </main>
    </body>
  </html>`;
};

export const createGraphRouter = (options: CreateGraphRouterOptions) => {
  const router = Router();

  router.get('/latest', async (_request, response) => {
    const session = await options.agentGraphStore.readLatestSession();

    if (!session) {
      response.status(404).type('text/plain').send('Agent graph session not found.');
      return;
    }

    response.status(200).type('html').send(renderGraphPage(session));
  });

  router.get('/:sessionId', async (request, response) => {
    const session = await options.agentGraphStore.readSession(request.params.sessionId);

    if (!session) {
      response.status(404).type('text/plain').send('Agent graph session not found.');
      return;
    }

    response.status(200).type('html').send(renderGraphPage(session));
  });

  return router;
};
