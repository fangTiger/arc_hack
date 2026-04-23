import { describe, expect, it } from 'vitest';

import {
  buildJudgments,
  createLiveWorkbenchViewModel,
  getDisplayHeadline,
  getDisplaySourceTitle,
  getGraphPresentationMode,
  inferEventType,
  type LiveWorkbenchSessionLike
} from '../src/routes/live-workbench.js';

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
  status: 'completed',
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

    const viewModel = createLiveWorkbenchViewModel(session, {
      panews: 'PANews',
      wublock123: '吴说',
      chaincatcher: 'ChainCatcher'
    });

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

    const viewModel = createLiveWorkbenchViewModel(session, {
      panews: 'PANews',
      wublock123: '吴说',
      chaincatcher: 'ChainCatcher'
    });
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
    expect(
      createLiveWorkbenchViewModel(session, {
        panews: 'PANews',
        wublock123: '吴说',
        chaincatcher: 'ChainCatcher'
      }).summary
    ).toBe('正文分析已完成，可在下方查看关键判断与证据摘录。');
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

    const viewModel = createLiveWorkbenchViewModel(session, {
      panews: 'PANews',
      wublock123: '吴说',
      chaincatcher: 'ChainCatcher'
    });

    expect(viewModel.briefing.length).toBeLessThan(longSummary.length);
    expect(viewModel.briefing).toContain('某协议完成新一轮战略合作');
    expect(viewModel.fullSummary).toBe(longSummary);
    expect(viewModel.judgments[0]?.previewBody.length).toBeLessThan(viewModel.judgments[0]?.body.length ?? 0);
    expect(viewModel.judgments[0]?.previewQuote.length).toBeLessThanOrEqual(
      viewModel.judgments[0]?.evidenceQuote.length ?? 0
    );
  });

  it('should downgrade running gateway copy to batch replay language', () => {
    const session = createSession({
      mode: 'gateway',
      status: 'running',
      steps: createSteps('running', 'pending', 'pending'),
      preview: {}
    });

    const viewModel = createLiveWorkbenchViewModel(session, {
      panews: 'PANews',
      wublock123: '吴说',
      chaincatcher: 'ChainCatcher'
    });

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
