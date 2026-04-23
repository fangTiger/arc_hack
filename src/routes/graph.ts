import { Router } from 'express';

import type { AgentSession } from '../demo/agent-graph.js';
import type { RuntimeEnv } from '../config/env.js';
import type { SourceMetadata } from '../domain/extraction/types.js';
import type { FileAgentGraphStore } from '../store/agent-graph-store.js';

type CreateGraphRouterOptions = {
  agentGraphStore: FileAgentGraphStore;
  runtimeEnv: RuntimeEnv;
};

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
        <strong>导入来源</strong>
        <p>未记录导入来源</p>
        <p class="summary">这个 session 来自旧版本产物，source metadata 不存在时页面会保持兼容展示。</p>
      </div>
    `;
  }

  return `
    <div class="meta-card source-card">
      <strong>导入来源</strong>
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
    : '<li>当前关系较弱，建议回到工作台结合关键判断与证据摘录继续复核。</li>';

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>知识图谱 ${escapeHtml(session.sessionId)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #eef2f7;
          --panel: rgba(255, 255, 255, 0.95);
          --border: rgba(15, 23, 42, 0.12);
          --text: #0f172a;
          --muted: #475569;
          --accent: #0f766e;
          --gold: #b45309;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          font-family: "Iowan Old Style", "Palatino Linotype", serif;
          color: var(--text);
          background:
            radial-gradient(circle at top left, rgba(15, 118, 110, 0.16), transparent 28rem),
            linear-gradient(180deg, #dde6ef 0%, var(--bg) 60%);
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
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
        }

        .hero {
          padding: 24px;
          margin-bottom: 20px;
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
          border: 1px solid rgba(148, 163, 184, 0.2);
          background:
            radial-gradient(circle at top left, rgba(15, 118, 110, 0.08), transparent 12rem),
            rgba(255, 255, 255, 0.9);
          min-height: 560px;
          padding: 18px;
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
          <div class="eyebrow">辅助关系浏览器</div>
          <h1>${escapeHtml(session.source.title ?? session.sessionId)}</h1>
          <p class="summary">独立 graph 页面只负责关系浏览，不承担结果主阅读。需要完整结论时，请回到工作台沿“事件总览 -> 关键判断 -> 证据摘录”继续查看。</p>
          <a class="return-link" href="/demo/live">返回工作台</a>
        </section>

        <section class="layout">
          <article class="panel">
            <div class="graph-header">
              <div class="eyebrow">关系浏览器</div>
              <h2>图谱画布</h2>
              <p class="summary">使用 ECharts 渲染，支持滚轮缩放与拖动画布。derived 仅用于浏览连通性，不代表真实抽取关系。</p>
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
                <div class="eyebrow">图谱说明</div>
                <h2>关系清单</h2>
                <ul class="relation-list">
                  ${relationList}
                </ul>
              </div>
              <div>
                <div class="eyebrow">来源元数据</div>
                <h2>导入来源</h2>
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
          let chart = null;

          const renderGraph = () => {
            if (!graphCanvas || !window.echarts || graphNodes.length === 0) {
              return;
            }

            chart = window.echarts.init(graphCanvas, null, { renderer: 'svg' });
            chart.setOption({
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
                  data: graphNodes,
                  links: graphLinks
                }
              ]
            });
          };

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
