import { Router } from 'express';

import { demoCorpus } from '../demo/corpus.js';
import { LiveAgentSessionService } from '../demo/live-session.js';
import type { RuntimeEnv } from '../config/env.js';

type CreateLiveRouterOptions = {
  liveSessionService: LiveAgentSessionService;
  runtimeEnv: RuntimeEnv;
};

type CreateSessionBody = {
  title?: string;
  text?: string;
  sourceType?: string;
};

const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const isValidSourceType = (value: string | undefined): value is 'news' | 'research' =>
  value === undefined || value === 'news' || value === 'research';

const isValidCreateSessionBody = (body: CreateSessionBody): body is Required<Pick<CreateSessionBody, 'text'>> & CreateSessionBody =>
  typeof body.text === 'string' && body.text.trim().length > 0;

const renderLiveConsolePage = (runtimeEnv: RuntimeEnv): string => {
  const sample = demoCorpus[0];

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
          <h1>把 agent 运行过程直接录进同一块屏幕</h1>
          <p>输入一段文本，点击开始，在页面里按阶段查看 summary、entities、relations、graph 和 payment evidence。当前服务端模式为 <strong>${escapeHtml(runtimeEnv.paymentMode)}</strong>。</p>
        </section>

        <section class="layout">
          <article class="panel">
            <h2>输入区</h2>
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
              <div class="button-row">
                <button id="start-button" class="primary" type="button">开始演示</button>
                <button id="fill-sample-button" class="secondary" type="button">填充示例</button>
              </div>
              <p id="form-message" class="muted">页面加载后会尝试恢复最近一次 live session。</p>
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
                <pre id="evidence-preview" class="muted">尚无支付证据</pre>
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
        const formMessage = document.getElementById('form-message');
        const titleInput = document.getElementById('title-input');
        const sourceTypeInput = document.getElementById('source-type-input');
        const textInput = document.getElementById('text-input');
        const startButton = document.getElementById('start-button');
        const fillSampleButton = document.getElementById('fill-sample-button');

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
          evidencePreview.textContent = runs.length > 0
            ? runs.map((run) => [
                run.operation,
                'requestId=' + run.requestId,
                'price=' + run.price,
                'paymentTransaction=' + run.paymentTransaction,
                'receiptTxHash=' + (run.receiptTxHash ?? 'n/a')
              ].join(' | ')).join('\\n')
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
            formMessage.textContent = '当前 sessionId: ' + session.sessionId;
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
            throw Object.assign(new Error(payload.error ?? 'Request failed.'), {
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

        fillSampleButton.addEventListener('click', () => {
          titleInput.value = sample.title ?? '';
          sourceTypeInput.value = sample.sourceType;
          textInput.value = sample.text;
          formMessage.textContent = '已填充示例文本。';
          formMessage.className = 'muted';
        });

        startButton.addEventListener('click', async () => {
          formMessage.textContent = '正在创建 live session...';
          formMessage.className = 'muted';

          try {
            const payload = await fetchJson('/demo/live/session', {
              method: 'POST',
              body: JSON.stringify({
                title: titleInput.value,
                text: textInput.value,
                sourceType: sourceTypeInput.value
              })
            });

            if (!payload) {
              return;
            }

            startPolling(payload.sessionId);
          } catch (error) {
            const message = error?.payload?.sessionId
              ? error.message + ' sessionId=' + error.payload.sessionId
              : error.message;
            formMessage.textContent = message;
            formMessage.className = 'error';
          }
        });

        const bootstrap = async () => {
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
    const body = (request.body ?? {}) as CreateSessionBody;

    if (!isValidCreateSessionBody(body) || !isValidSourceType(body.sourceType)) {
      response.status(400).json({ error: 'invalid_live_session_input' });
      return;
    }

    const result = await options.liveSessionService.startSession({
      title: body.title,
      text: body.text,
      sourceType: body.sourceType
    });

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
