import { Router } from 'express';

import type { AgentSession } from '../demo/agent-graph.js';
import type { RuntimeEnv } from '../config/env.js';
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

const renderGraphPage = (session: AgentSession, runtimeEnv: RuntimeEnv): string => {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Agent Graph ${escapeHtml(session.sessionId)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f1f5f9;
          --panel: rgba(255, 255, 255, 0.92);
          --border: rgba(15, 23, 42, 0.12);
          --text: #0f172a;
          --muted: #475569;
          --accent: #0f766e;
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
          max-width: 1120px;
          margin: 0 auto;
          padding: 32px 20px 56px;
        }

        .hero, .panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
        }

        .hero {
          padding: 28px;
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
          font-size: 18px;
          line-height: 1.65;
          max-width: 65ch;
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

        .copy-button {
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.1);
          color: var(--accent);
          font-size: 13px;
          cursor: pointer;
        }

        .explorer-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 118, 110, 0.22);
          background: rgba(15, 118, 110, 0.08);
          color: var(--accent);
          font-size: 13px;
          text-decoration: none;
        }

        .copy-button:disabled {
          opacity: 0.7;
          cursor: default;
        }

        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
          gap: 20px;
        }

        .panel {
          padding: 24px;
        }

        .run-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }

        h1, h2, h3 { margin-top: 0; }
        ul { padding-left: 18px; color: var(--muted); }
        p { margin: 6px 0; }
        svg { width: 100%; height: auto; display: block; }

        @media (max-width: 840px) {
          .layout {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main>
        <section class="hero">
          <div class="eyebrow">Agent Graph Session</div>
          <h1>${escapeHtml(session.source.title ?? 'Untitled Source')}</h1>
          <p><strong>sessionId</strong>: ${escapeHtml(session.sessionId)}</p>
          <p class="summary">${escapeHtml(session.summary)}</p>
          <div class="meta">
            <div class="meta-card">
              <strong>Total Price</strong>
              <p>${escapeHtml(session.totals.totalPrice)}</p>
            </div>
            <div class="meta-card">
              <strong>Successful Runs</strong>
              <p>${session.totals.successfulRuns}</p>
            </div>
            <div class="meta-card">
              <strong>Source Type</strong>
              <p>${escapeHtml(session.source.sourceType)}</p>
            </div>
          </div>
        </section>

        <section class="layout">
          <article class="panel">
            <h2>Graph Nodes</h2>
            ${renderGraphSvg(session)}
          </article>

          <article class="panel">
            <h2>Relations</h2>
            <ul>
              ${session.relations
                .map((relation) => `<li>${escapeHtml(relation.source)} ${escapeHtml(relation.relation)} ${escapeHtml(relation.target)}</li>`)
                .join('')}
            </ul>
            <h2>Source Text</h2>
            <p class="summary">${escapeHtml(session.source.text)}</p>
          </article>
        </section>

        <section class="panel" style="margin-top: 20px;">
          <h2>Payment Evidence</h2>
          <div class="run-grid">
            ${renderRunCards(session, runtimeEnv)}
          </div>
        </section>

        <script>
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

          window.copyField = copyField;
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
