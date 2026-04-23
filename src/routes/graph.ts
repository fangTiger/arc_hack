import { Router } from 'express';

import type { AgentSession } from '../demo/agent-graph.js';
import type { RuntimeEnv } from '../config/env.js';
import type { SourceMetadata } from '../domain/extraction/types.js';
import type { FileAgentGraphStore } from '../store/agent-graph-store.js';
import {
  buildArcExplorerAddressUrl,
  buildArcExplorerTransactionUrl,
  isHexAddress,
  isHexTransactionHash
} from '../support/arc-explorer.js';

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

const renderGraphSvg = (session: AgentSession): string => {
  const edges = session.graph.edges
    .map((edge) => {
      const source = session.graph.nodes.find((node) => node.id === edge.source);
      const target = session.graph.nodes.find((node) => node.id === edge.target);

      if (!source || !target) {
        return '';
      }

      const labelX = Math.round((source.x + target.x) / 2);
      const labelY = Math.round((source.y + target.y) / 2);

      return `
        <line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="#94a3b8" stroke-width="2" />
        <text x="${labelX}" y="${labelY - 8}" text-anchor="middle" fill="#334155" font-size="12">${escapeHtml(edge.label)}</text>
      `;
    })
    .join('');
  const nodes = session.graph.nodes
    .map(
      (node) => `
        <g>
          <circle cx="${node.x}" cy="${node.y}" r="26" fill="${node.color}" opacity="0.92" />
          <text x="${node.x}" y="${node.y + 42}" text-anchor="middle" fill="#0f172a" font-size="13">${escapeHtml(node.label)}</text>
        </g>
      `
    )
    .join('');

  return `
    <svg viewBox="0 0 480 440" role="img" aria-label="Knowledge graph">
      <rect x="0" y="0" width="480" height="440" rx="24" fill="#f8fafc" />
      ${edges}
      ${nodes}
    </svg>
  `;
};

const renderRunCards = (session: AgentSession, runtimeEnv: RuntimeEnv): string => {
  return session.runs
    .map(
      (run) => `
        <article class="run-card">
          <h3>${escapeHtml(run.operation)}</h3>
          ${renderEvidenceField('requestId', run.requestId)}
          <p><strong>price</strong>: ${escapeHtml(run.price)}</p>
          ${renderEvidenceField('paymentTransaction', run.paymentTransaction)}
          <p><strong>paymentAmount</strong>: ${escapeHtml(run.paymentAmount)}</p>
          <p><strong>paymentNetwork</strong>: ${escapeHtml(run.paymentNetwork)}</p>
          ${renderEvidenceField('paymentPayer', run.paymentPayer, isHexAddress(run.paymentPayer)
            ? {
                explorerUrl: buildArcExplorerAddressUrl(run.paymentPayer, runtimeEnv),
                explorerLabel: '地址'
              }
            : {})}
          ${renderEvidenceField('payloadHash', run.payloadHash)}
          ${renderEvidenceField(
            'receiptTxHash',
            run.receiptTxHash ?? 'n/a',
            isHexTransactionHash(run.receiptTxHash)
              ? {
                  explorerUrl: buildArcExplorerTransactionUrl(run.receiptTxHash, runtimeEnv),
                  explorerLabel: '链上交易'
                }
              : {}
          )}
        </article>
      `
    )
    .join('');
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
      ${renderEvidenceField('articleUrl', metadata.articleUrl ?? 'n/a', metadata.articleUrl ? {
        explorerUrl: metadata.articleUrl,
        explorerLabel: '原文'
      } : {})}
      ${renderEvidenceField('sourceSite', metadata.sourceSite ?? 'n/a')}
      ${renderEvidenceField('importMode', metadata.importMode ? formatImportMode(metadata.importMode) : 'n/a')}
      ${renderEvidenceField('importStatus', metadata.importStatus ? formatImportStatus(metadata.importStatus) : 'n/a')}
      ${renderEvidenceField('cachedAt', metadata.cachedAt ?? 'n/a')}
      ${renderEvidenceField('title', session.source.title ?? 'n/a')}
    </div>
  `;
};

const renderGraphPage = (session: AgentSession, runtimeEnv: RuntimeEnv): string => {
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
        opacity: edge.provenance === 'derived' ? 0.64 : 0.88
      }
    }))
  );
  const relationList = session.relations.length > 0
    ? session.relations
        .map((relation) => `<li>${escapeHtml(relation.source)} ${escapeHtml(relation.relation)} ${escapeHtml(relation.target)}</li>`)
        .join('')
    : '<li>当前关系较弱，建议回到工作台结合原文与凭证继续复核。</li>';

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>知识图谱 ${escapeHtml(session.sessionId)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f1f5f9;
          --panel: rgba(255, 255, 255, 0.94);
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
            linear-gradient(180deg, #e2e8f0 0%, var(--bg) 60%);
        }

        main {
          max-width: 1480px;
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
          font-size: 17px;
          line-height: 1.7;
          max-width: 75ch;
        }

        .meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 14px;
          margin-top: 20px;
        }

        .meta-card, .run-card {
          background: rgba(248, 250, 252, 0.92);
          border: 1px solid rgba(148, 163, 184, 0.26);
          border-radius: 18px;
          padding: 16px;
        }

        .source-card {
          display: grid;
          gap: 10px;
        }

        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.82fr);
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
        .run-card h3,
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

        .run-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
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
          <div class="eyebrow">知识图谱</div>
          <h1>${escapeHtml(session.source.title ?? '未命名来源')}</h1>
          <p><strong>sessionId</strong>: ${escapeHtml(session.sessionId)}</p>
          <p class="summary">${escapeHtml(session.summary)}</p>
          <div class="meta">
            <div class="meta-card">
              <strong>总成本</strong>
              <p>${escapeHtml(session.totals.totalPrice)}</p>
            </div>
            <div class="meta-card">
              <strong>成功调用</strong>
              <p>${session.totals.successfulRuns}</p>
            </div>
            <div class="meta-card">
              <strong>来源类型</strong>
              <p>${escapeHtml(session.source.sourceType === 'news' ? '新闻 / 资讯' : session.source.sourceType)}</p>
            </div>
            ${renderSourceMetadata(session)}
          </div>
        </section>

        <section class="layout">
          <article class="panel">
            <div class="graph-header">
              <div class="eyebrow">关系图</div>
              <h2>实体与关系浏览</h2>
              <p class="summary">使用 ECharts 渲染，支持滚轮缩放与拖动画布。original 来自抽取结果，derived 仅用于展示连通性。</p>
              <div class="hint-row">
                <span class="hint-pill">滚轮缩放</span>
                <span class="hint-pill">拖动画布</span>
                <span class="hint-pill">derived 仅用于展示连通性</span>
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
                <div class="eyebrow">原文</div>
                <h2>Source Text</h2>
                <p class="summary">${escapeHtml(session.source.text)}</p>
              </div>
            </div>
          </article>
        </section>

        <section class="panel" style="margin-top: 20px;">
          <h2>分析凭证</h2>
          <div class="run-grid">
            ${renderRunCards(session, runtimeEnv)}
          </div>
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

    response.status(200).type('html').send(renderGraphPage(session, options.runtimeEnv));
  });

  router.get('/:sessionId', async (request, response) => {
    const session = await options.agentGraphStore.readSession(request.params.sessionId);

    if (!session) {
      response.status(404).type('text/plain').send('Agent graph session not found.');
      return;
    }

    response.status(200).type('html').send(renderGraphPage(session, options.runtimeEnv));
  });

  return router;
};
