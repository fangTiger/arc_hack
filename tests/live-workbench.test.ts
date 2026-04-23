import { describe, expect, it } from 'vitest';

import {
  buildJudgments,
  createLiveWorkbenchViewModel,
  getDisplayHeadline,
  getDisplaySourceTitle,
  getGraphPresentationMode,
  inferEventType,
  shouldAcceptLiveSnapshot,
  type LiveWorkbenchSessionLike
} from '../src/routes/live-workbench.js';

const supportedSourceLabels = {
  panews: 'PANews',
  wublock123: '吴说',
  chaincatcher: 'ChainCatcher'
} as const;

const createSteps = (
  summary: 'pending' | 'running' | 'completed' | 'failed',
  entities: 'pending' | 'running' | 'completed' | 'failed',
  relations: 'pending' | 'running' | 'completed' | 'failed'
) => [
  { key: 'summary' as const, status: summary },
  { key: 'entities' as const, status: entities },
  { key: 'relations' as const, status: relations }
];

const createSession = (overrides: Partial<LiveWorkbenchSessionLike> = {}): LiveWorkbenchSessionLike => ({
  sessionId: 'session-001',
  status: 'completed',
  createdAt: '2026-04-23T09:59:00.000Z',
  updatedAt: '2026-04-23T10:00:00.000Z',
  source: {
    sourceType: 'news',
    title: 'PANews：某协议完成 5000 万美元融资',
    text: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。Arc 与 Circle 将为其提供结算能力。该协议计划在第二季度上线新产品。',
    metadata: {
      importMode: 'link',
      sourceSite: 'panews'
    }
  },
  steps: createSteps('completed', 'completed', 'completed'),
  preview: {
    summary: '某协议完成 5000 万美元融资，并引入 Arc 与 Circle 的结算能力。',
    entities: [
      { name: 'Arc', type: 'organization' },
      { name: 'Circle', type: 'organization' }
    ],
    relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
  },
  agentSession: {
    totals: {
      totalPrice: '$0.012',
      successfulRuns: 3
    }
  },
  ...overrides
});

describe('live workbench view model', () => {
  it('should protect terminal snapshots from older queued or running responses', () => {
    const completedSession = createSession({
      sessionId: 'session-terminal',
      status: 'completed',
      updatedAt: '2026-04-23T10:03:00.000Z'
    });
    const staleRunningSession = createSession({
      sessionId: 'session-terminal',
      status: 'running',
      updatedAt: '2026-04-23T10:01:00.000Z',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });
    const staleQueuedSession = createSession({
      sessionId: 'session-terminal',
      status: 'queued',
      updatedAt: '2026-04-23T10:00:30.000Z',
      steps: createSteps('pending', 'pending', 'pending'),
      preview: {}
    });

    expect(shouldAcceptLiveSnapshot(completedSession, staleRunningSession)).toBe(false);
    expect(shouldAcceptLiveSnapshot(completedSession, staleQueuedSession)).toBe(false);
  });

  it('should let a terminal snapshot override a non-terminal snapshot for the same session', () => {
    const runningSession = createSession({
      sessionId: 'session-terminal-priority',
      status: 'running',
      updatedAt: '2026-04-23T10:03:00.000Z',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });
    const completedSession = createSession({
      sessionId: 'session-terminal-priority',
      status: 'completed',
      updatedAt: '2026-04-23T10:02:00.000Z'
    });

    expect(shouldAcceptLiveSnapshot(runningSession, completedSession)).toBe(true);
  });

  it('should remain self-contained when serialized into the browser poller', () => {
    const runningSession = createSession({
      sessionId: 'session-terminal-priority',
      status: 'running',
      updatedAt: '2026-04-23T10:03:00.000Z',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });
    const completedSession = createSession({
      sessionId: 'session-terminal-priority',
      status: 'completed',
      updatedAt: '2026-04-23T10:02:00.000Z'
    });
    const serialized = shouldAcceptLiveSnapshot.toString();
    const browserSafeFunction = new Function(`return (${serialized});`)() as typeof shouldAcceptLiveSnapshot;

    expect(browserSafeFunction(runningSession, completedSession)).toBe(true);
    expect(browserSafeFunction(completedSession, runningSession)).toBe(false);
  });

  it('should not classify amount-only market news as financing', () => {
    const session = createSession({
      source: {
        sourceType: 'news',
        title: '吴说获悉：香港虚拟资产 ETF 本周净流入创新高',
        text: '香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点，单周净流入超过 2000 万美元。',
        metadata: {
          importMode: 'link',
          sourceSite: 'wublock123'
        }
      },
      preview: {
        summary: '香港虚拟资产 ETF 本周净流入创新高。',
        entities: [],
        relations: []
      }
    });

    expect(inferEventType(session)).toBe('监管 / 市场资讯');
  });

  it('should not classify secure infrastructure copy as SEC regulation news', () => {
    const session = createSession({
      source: {
        sourceType: 'news',
        title: 'Arc secure settlement infrastructure update',
        text: 'Arc secure settlement infrastructure continues to reduce payment latency for AI agents in the second quarter.',
        metadata: {
          importMode: 'manual'
        }
      },
      preview: {
        summary: 'Arc secure settlement infrastructure reduces payment latency for AI agents.',
        entities: [],
        relations: []
      }
    });

    expect(inferEventType(session)).toBe('市场资讯');
  });

  it('should still classify explicit funding news as financing', () => {
    const session = createSession();

    expect(inferEventType(session)).toBe('融资');
  });

  it('should not generate judgments before summary is completed', () => {
    const session = createSession({
      status: 'queued',
      steps: createSteps('pending', 'pending', 'pending'),
      preview: {}
    });

    expect(buildJudgments(session)).toEqual([]);
  });

  it('should expose pending-import page-state copy before any session starts', () => {
    const viewModel = createLiveWorkbenchViewModel(null, supportedSourceLabels);

    expect(viewModel.headline).toBe('等待分析开始');
    expect(viewModel.summary).toContain('待导入');
    expect(viewModel.summary).toContain('导入仓');
    expect(viewModel.eventTypeValue).toBe('待识别');
    expect(viewModel.sourceModeValue).toBe('待输入');
  });

  it('should gate entity and relation judgments until their steps complete', () => {
    const session = createSession({
      status: 'running',
      steps: createSteps('completed', 'running', 'pending'),
      preview: {
        summary: '某协议完成 5000 万美元融资，并引入 Arc 与 Circle 的结算能力。',
        entities: [],
        relations: []
      }
    });

    const judgments = buildJudgments(session);

    expect(judgments).toHaveLength(1);
    expect(judgments[0]).toMatchObject({
      kicker: '事件判断',
      evidenceTitle: '相关原文片段'
    });
    expect(judgments[0]?.title).toContain('初步归类');
  });

  it('should retain the previous completed result while a re-run is still in progress', () => {
    const session = createSession({
      status: 'running',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {},
      agentSession: {
        summary: '上一版结果显示某协议完成融资，并引入 Arc 与 Circle 作为关键结算主体。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }],
        totals: {
          totalPrice: '$0.012',
          successfulRuns: 3
        }
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.summary).toContain('分析中');
    expect(viewModel.summary).toContain('旧结果');
    expect(viewModel.judgments).toHaveLength(3);
    expect(viewModel.judgments[0]?.title).toContain('初步归类');
    expect(viewModel.evidenceSectionNote).toContain('上一版');
  });

  it('should keep the retained-result headline during a manual re-run without a source title', () => {
    const session = createSession({
      status: 'running',
      source: {
        sourceType: 'research',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
        metadata: {
          importMode: 'manual'
        }
      },
      steps: createSteps('running', 'pending', 'pending'),
      preview: {},
      agentSession: {
        summary: 'Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }],
        totals: {
          totalPrice: '$0.012',
          successfulRuns: 3
        }
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.headline).toBe('Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层');
    expect(viewModel.headline).not.toBe('等待事件判断生成');
    expect(viewModel.headline).not.toBe('分析未完成');
  });

  it('should keep the previous completed result visible when the re-run fails', () => {
    const session = createSession({
      status: 'failed',
      steps: createSteps('failed', 'pending', 'pending'),
      preview: {},
      agentSession: {
        summary: '上一版结果显示某协议完成融资，并引入 Arc 与 Circle 作为关键结算主体。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }],
        totals: {
          totalPrice: '$0.012',
          successfulRuns: 3
        }
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.summary).toContain('分析失败');
    expect(viewModel.summary).toContain('旧结果');
    expect(viewModel.judgments).toHaveLength(3);
    expect(viewModel.evidenceSectionNote).toContain('失败反馈');
  });

  it('should keep the retained-result headline after a manual re-run fails', () => {
    const session = createSession({
      status: 'failed',
      source: {
        sourceType: 'research',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
        metadata: {
          importMode: 'manual'
        }
      },
      steps: createSteps('failed', 'pending', 'pending'),
      preview: {},
      agentSession: {
        summary: 'Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }],
        totals: {
          totalPrice: '$0.012',
          successfulRuns: 3
        }
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.headline).toBe('Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层');
    expect(viewModel.headline).not.toBe('等待事件判断生成');
    expect(viewModel.headline).not.toBe('分析未完成');
  });

  it('should downgrade evidence wording to manual-review language', () => {
    const session = createSession({
      source: {
        sourceType: 'news',
        title: 'PANews：某协议完成 5000 万美元融资',
        text: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。Arc 与 Circle 将为其提供结算能力。',
        metadata: {
          importMode: 'link',
          sourceSite: 'panews',
          importStatus: 'cache',
          cachedAt: '2026-04-22T11:22:33.000Z'
        }
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.eventTypeValue).toContain('初步归类');
    expect(viewModel.evidenceSectionNote).toContain('人工复核');
    expect(viewModel.judgments[0]?.evidenceTitle).toBe('相关原文片段');
    expect(viewModel.judgments[0]?.evidenceRoleLine).toContain('参考用途');
    expect(viewModel.judgments[0]?.evidenceRoleLine).not.toContain('支持：');
  });

  it('should distinguish empty entity results from unfinished entity extraction', () => {
    const session = createSession({
      steps: createSteps('completed', 'completed', 'pending'),
      preview: {
        summary: '市场消息已返回，但实体结果为空。',
        entities: [],
        relations: []
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);
    const judgments = buildJudgments(session);

    expect(viewModel.entityStepStatus).toBe('completed');
    expect(viewModel.entities).toEqual([]);
    expect(judgments[1]?.title).toBe('暂未识别到稳定主体');
  });

  it('should derive a display title from the model summary when manual text omits title', () => {
    const session = createSession({
      source: {
        sourceType: 'research',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
        metadata: {
          importMode: 'manual'
        }
      },
      preview: {
        summary: 'Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层。',
        entities: [],
        relations: []
      }
    });

    expect(getDisplaySourceTitle(session)).toBe('Arc 为 AI 代理引入无 gas 小额支付，并接入 Circle 作为结算层');
    expect(getDisplayHeadline(session)).toBe('事件判断已生成');
    expect(createLiveWorkbenchViewModel(session, supportedSourceLabels).summary).toBe(
      '正文分析已完成，可在下方查看关键判断与证据摘录。'
    );
  });

  it('should hide manual source text from the event overview before summary completes', () => {
    const longManualText =
      '这是一段非常长的手动输入正文，用来模拟用户直接粘贴一整段新闻或研究材料。系统在大模型返回前不应该把这段正文首句直接展示在事件总览里，以免首屏看起来像在回显原文而不是分析结果。';
    const session = createSession({
      status: 'running',
      source: {
        sourceType: 'research',
        text: longManualText,
        metadata: {
          importMode: 'manual'
        }
      },
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(getDisplayHeadline(session)).toBe('等待事件判断生成');
    expect(viewModel.headline).toBe('等待事件判断生成');
    expect(viewModel.headline).not.toContain('这是一段非常长的手动输入正文');
    expect(viewModel.summary).toContain('事件判断正在生成');
  });

  it('should compress long summaries into briefing while preserving full summary for details', () => {
    const longSummary =
      '某协议完成新一轮战略合作，并计划在亚太市场扩展支付网络。Arc 负责代理侧支付编排，Circle 提供结算层与稳定币流转能力。团队同时披露了多阶段落地计划、渠道推进安排以及后续产品发布时间表。';
    const session = createSession({
      preview: {
        summary: longSummary,
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }]
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.briefing.length).toBeLessThan(longSummary.length);
    expect(viewModel.briefing).toContain('某协议完成新一轮战略合作');
    expect(viewModel.fullSummary).toBe(longSummary);
    expect(viewModel.judgments[0]?.previewBody.length).toBeLessThan(viewModel.judgments[0]?.body.length ?? 0);
    expect(viewModel.judgments[0]?.previewQuote.length).toBeLessThanOrEqual(
      viewModel.judgments[0]?.evidenceQuote.length ?? 0
    );
  });

  it('should enrich judgment detail payloads with source status and evidence context', () => {
    const session = createSession({
      source: {
        sourceType: 'news',
        title: 'PANews：某协议完成 5000 万美元融资',
        text: [
          'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
          'Arc 将负责代理支付编排，并与 Circle 共同提供结算能力。',
          '团队表示，新资金将优先用于扩展亚洲市场和合规建设。',
          '管理层预计第三季度发布面向机构客户的新产品线。'
        ].join(' '),
        metadata: {
          articleUrl: 'https://www.panewslab.com/articles/0123456789',
          sourceSite: 'panews',
          importMode: 'link',
          importStatus: 'cache',
          cachedAt: '2026-04-22T11:22:33.000Z'
        }
      },
      preview: {
        summary: '某协议完成 5000 万美元融资，并引入 Arc 与 Circle 作为结算与支付编排伙伴。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }]
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.judgments[0]?.detailTags).toEqual(expect.arrayContaining(['融资（初步归类）', '重要性 高']));
    expect(viewModel.judgments[0]?.detailSourceStatus).toBe('PANews · 链接导入 · 缓存回退');
    expect(viewModel.judgments[1]?.evidenceDetail).toMatchObject({
      currentQuote: 'Arc 将负责代理支付编排，并与 Circle 共同提供结算能力。',
      previousQuote: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
      nextQuote: '团队表示，新资金将优先用于扩展亚洲市场和合规建设。',
      sourceSite: 'PANews',
      importModeLabel: '链接导入',
      importStatusLabel: '缓存回退',
      cachedAt: '2026-04-22T11:22:33.000Z',
      articleUrl: 'https://www.panewslab.com/articles/0123456789'
    });
  });

  it('should build structured deep reading content after analysis is ready', () => {
    const session = createSession({
      source: {
        sourceType: 'news',
        title: 'PANews：某协议完成 5000 万美元融资',
        text: [
          'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
          'Arc 将负责代理支付编排，并与 Circle 共同提供结算能力。',
          '团队表示，新资金将优先用于扩展亚洲市场和合规建设。'
        ].join(' '),
        metadata: {
          importMode: 'link',
          sourceSite: 'panews',
          importStatus: 'cache',
          cachedAt: '2026-04-22T11:22:33.000Z'
        }
      },
      preview: {
        summary: '某协议完成 5000 万美元融资，并引入 Arc 与 Circle 作为结算与支付编排伙伴。',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ],
        relations: [{ source: 'Arc', relation: 'partners_with', target: 'Circle' }]
      }
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.deepReadingLead).toContain('完整摘要');
    expect(viewModel.deepReadingSections).toHaveLength(3);
    expect(viewModel.deepReadingSections[0]).toMatchObject({
      title: '完整摘要',
      body: '某协议完成 5000 万美元融资，并引入 Arc 与 Circle 作为结算与支付编排伙伴。'
    });
    expect(viewModel.deepReadingSections[1]?.title).toBe('延展判断');
    expect(viewModel.deepReadingSections[1]?.body).toContain('初步归类为融资');
    expect(viewModel.deepReadingSections[2]).toMatchObject({
      title: '复核提示'
    });
    expect(viewModel.deepReadingSections[2]?.body).toContain('链接导入 · 缓存回退');
    expect(viewModel.deepReadingSections[2]?.body).toContain('3 条凭证已回填');
  });

  it('should downgrade running gateway copy to batch replay language', () => {
    const session = createSession({
      mode: 'gateway',
      status: 'running',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });

    const viewModel = createLiveWorkbenchViewModel(session, supportedSourceLabels);

    expect(viewModel.summary).toContain('批量支付与结果处理进行中');
  });

  it('should choose list mode when graph data is too weak for chart rendering', () => {
    const session = createSession({
      agentSession: {
        graph: {
          nodes: [
            {
              id: 'Arc',
              label: 'Arc',
              type: 'organization',
              color: '#0f766e',
              x: 240,
              y: 220
            }
          ],
          edges: []
        }
      }
    });

    expect(getGraphPresentationMode(session)).toBe('list');
  });

  it('should choose chart mode when graph has enough nodes and edges', () => {
    const session = createSession({
      agentSession: {
        graph: {
          nodes: [
            {
              id: 'Arc',
              label: 'Arc',
              type: 'organization',
              color: '#0f766e',
              x: 120,
              y: 220
            },
            {
              id: 'Circle',
              label: 'Circle',
              type: 'organization',
              color: '#2563eb',
              x: 360,
              y: 220
            }
          ],
          edges: [
            {
              id: 'Arc:mentions:Circle',
              source: 'Arc',
              target: 'Circle',
              label: 'mentions',
              provenance: 'original'
            }
          ]
        }
      }
    });

    expect(getGraphPresentationMode(session)).toBe('chart');
  });
});
