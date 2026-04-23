import type {
  ExtractionEntity,
  ExtractionRelation,
  SourceMetadata,
  SourceType
} from '../domain/extraction/types.js';
import type { SupportedNewsSite } from '../domain/news-import/types.js';

export type LiveWorkbenchStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type LiveWorkbenchStepLike = {
  key: 'summary' | 'entities' | 'relations';
  status?: LiveWorkbenchStepStatus;
  price?: string;
};

export type LiveWorkbenchSessionLike = {
  status?: 'queued' | 'running' | 'completed' | 'failed';
  mode?: 'mock' | 'gateway';
  source?: {
    sourceType?: SourceType;
    title?: string;
    text?: string;
    metadata?: SourceMetadata;
  };
  steps?: LiveWorkbenchStepLike[];
  preview?: {
    summary?: string;
    entities?: ExtractionEntity[];
    relations?: ExtractionRelation[];
  };
  agentSession?: {
    summary?: string;
    entities?: ExtractionEntity[];
    relations?: ExtractionRelation[];
    graph?: {
      nodes?: Array<{
        id: string;
        label: string;
        type: ExtractionEntity['type'] | 'unknown';
        color: string;
        x: number;
        y: number;
      }>;
      edges?: Array<{
        id: string;
        source: string;
        target: string;
        label: string;
        provenance: 'original' | 'derived';
      }>;
    };
    totals?: {
      totalPrice?: string;
      successfulRuns?: number;
    };
  };
};

export type SupportedSourceLabelMap = Partial<Record<SupportedNewsSite, string>>;

export type LiveWorkbenchJudgment = {
  kicker: string;
  title: string;
  body: string;
  evidenceTitle: string;
  evidenceQuote: string;
  evidenceRoleLine: string;
  meta: string[];
};

export type LiveWorkbenchViewModel = {
  headline: string;
  summary: string;
  eventTypeValue: string;
  importanceValue: string;
  sourceModeValue: string;
  totalPriceValue: string;
  judgments: LiveWorkbenchJudgment[];
  evidenceSectionNote: string;
  sourceLabel: string;
  sourceTypeLabel: string;
  importModeLabel: string;
  importStatusLabel: string;
  articleUrl?: string;
  cachedAt?: string;
  entities: ExtractionEntity[];
  entityStepStatus: LiveWorkbenchStepStatus;
};

export type LiveWorkbenchGraphMode = 'empty' | 'list' | 'chart';

export function getStepStatus(
  session: LiveWorkbenchSessionLike | null | undefined,
  key: LiveWorkbenchStepLike['key']
): LiveWorkbenchStepStatus {
  return session?.steps?.find((step) => step.key === key)?.status ?? 'pending';
}

export function extractSentences(text: string | undefined): string[] {
  const normalized = String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  const sentences =
    normalized
      .match(/[^。！？!?]+[。！？!?]?/g)
      ?.map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  if (sentences.length > 0) {
    return sentences;
  }

  return [normalized.slice(0, 140)];
}

export function getSummary(session: LiveWorkbenchSessionLike | null | undefined): string {
  return session?.preview?.summary ?? session?.agentSession?.summary ?? '';
}

export function getEntities(session: LiveWorkbenchSessionLike | null | undefined): ExtractionEntity[] {
  return session?.preview?.entities ?? session?.agentSession?.entities ?? [];
}

export function getRelations(session: LiveWorkbenchSessionLike | null | undefined): ExtractionRelation[] {
  return session?.preview?.relations ?? session?.agentSession?.relations ?? [];
}

export function getSourceMetadata(session: LiveWorkbenchSessionLike | null | undefined): SourceMetadata {
  return session?.source?.metadata ?? {};
}

export function getGraphPresentationMode(session: LiveWorkbenchSessionLike | null | undefined): LiveWorkbenchGraphMode {
  const nodes = session?.agentSession?.graph?.nodes ?? [];
  const edges = session?.agentSession?.graph?.edges ?? [];

  if (nodes.length === 0) {
    return 'empty';
  }

  if (nodes.length < 2 || edges.length === 0) {
    return 'list';
  }

  return 'chart';
}

export function formatImportStatusLabel(importStatus: SourceMetadata['importStatus'] | undefined): string {
  if (importStatus === 'cache') {
    return '缓存回退';
  }

  if (importStatus === 'live') {
    return '实时抓取';
  }

  return '未标记导入状态';
}

export function formatImportModeLabel(importMode: SourceMetadata['importMode'] | undefined): string {
  switch (importMode) {
    case 'link':
      return '白名单链接';
    case 'preset':
      return '预置样本';
    case 'manual':
      return '手动文本';
    default:
      return '待输入';
  }
}

export function getDisplayHeadline(session: LiveWorkbenchSessionLike | null | undefined): string {
  if (!session) {
    return '等待分析开始';
  }

  const sourceTitle = session.source?.title?.trim();

  if (sourceTitle) {
    return sourceTitle;
  }

  const summary = getSummary(session).trim();

  if (summary) {
    return summary;
  }

  return extractSentences(session.source?.text ?? '')[0] ?? '等待事件判断生成';
}

export function inferEventType(session: LiveWorkbenchSessionLike | null | undefined): string {
  const haystack = [session?.source?.title, getSummary(session), session?.source?.text]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(融资|获投|种子轮|天使轮|pre[-\s]?a|a轮|b轮|c轮|战略投资|raised|funding|investment)/.test(haystack)) {
    return '融资';
  }

  if (/(攻击|漏洞|被盗|exploit|hack|security)/.test(haystack)) {
    return '安全事件';
  }

  if (/(合作|联合|partner|collabor|integration|集成)/.test(haystack)) {
    return '合作';
  }

  if (/(发布|上线|推出|launch|introduc|release)/.test(haystack)) {
    return '产品发布';
  }

  if (/(监管|政策|合规|牌照|etf|\bu\.?s\.?\s*sec\b|\bsec\b|审批|approval)/.test(haystack)) {
    return '监管 / 市场资讯';
  }

  return '市场资讯';
}

export function inferImportance(session: LiveWorkbenchSessionLike | null | undefined): string {
  const eventType = inferEventType(session);
  const entities = getEntities(session).length;
  const relations = getRelations(session).length;

  if (eventType === '安全事件' || eventType === '融资') {
    return '高';
  }

  if (entities >= 2 || relations >= 1 || Boolean(getSummary(session))) {
    return '中';
  }

  return '低';
}

export function getDisplaySource(
  session: LiveWorkbenchSessionLike | null | undefined,
  supportedSourceLabels: SupportedSourceLabelMap
): string {
  const metadata = getSourceMetadata(session);

  if (metadata.sourceSite && supportedSourceLabels[metadata.sourceSite]) {
    return supportedSourceLabels[metadata.sourceSite]!;
  }

  return session?.source?.sourceType === 'research' ? '研究材料' : '手动输入';
}

export function getTotalPrice(session: LiveWorkbenchSessionLike | null | undefined): string {
  if (!session) {
    return 'n/a';
  }

  if (session.agentSession?.totals?.totalPrice) {
    return session.agentSession.totals.totalPrice;
  }

  const knownPrices = (session.steps ?? [])
    .map((step) => {
      const numericValue = Number(String(step.price ?? '').replace('$', ''));
      return Number.isFinite(numericValue) ? numericValue : null;
    })
    .filter((value): value is number => value !== null);

  if (knownPrices.length === 0) {
    return session.status === 'failed' ? 'n/a' : '处理中';
  }

  const total = knownPrices.reduce((sum, value) => sum + value, 0);
  return `$${total.toFixed(3)}`;
}

export function buildJudgments(session: LiveWorkbenchSessionLike | null | undefined): LiveWorkbenchJudgment[] {
  if (!session || getStepStatus(session, 'summary') !== 'completed') {
    return [];
  }

  const summary = getSummary(session);
  const entities = getEntities(session);
  const relations = getRelations(session);
  const sentences = extractSentences(session.source?.text ?? '');
  const metadata = getSourceMetadata(session);
  const eventType = inferEventType(session);
  const importance = inferImportance(session);
  const judgments: LiveWorkbenchJudgment[] = [
    {
      kicker: '事件判断',
      title: `初步归类为${eventType}`,
      body: summary || '事件摘要已返回，但仍建议结合原文与凭证继续人工复核。',
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[0] ?? summary ?? '等待原文片段到位。',
      evidenceRoleLine: '参考用途：辅助人工复核事件判断，暂未做逐句证据对齐。',
      meta: [`${eventType}（初步归类）`, `重要性 ${importance}`]
    }
  ];

  if (getStepStatus(session, 'entities') === 'completed') {
    const entityNames = entities.slice(0, 3).map((entity) => entity.name);
    judgments.push({
      kicker: '主体判断',
      title: entityNames.length > 0 ? `优先关注 ${entityNames.slice(0, 2).join(' / ')}` : '暂未识别到稳定主体',
      body:
        entityNames.length > 0
          ? `已识别 ${entities.length} 个主体，适合先确认它们在原文里的角色，再决定是否继续跟进。`
          : '实体抽取已完成，但仍建议结合原文上下文确认主体角色。',
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[1] ?? sentences[0] ?? summary ?? '等待主体相关片段到位。',
      evidenceRoleLine: '参考用途：辅助人工复核核心主体，暂未做逐句证据对齐。',
      meta: [
        entities.length > 0 ? `${entities.length} 个主体` : '主体待确认',
        getStepStatus(session, 'relations') === 'completed' ? `${relations.length} 条关系` : '关系待补全'
      ]
    });
  }

  if (getStepStatus(session, 'relations') === 'completed') {
    const firstRelation = relations[0];
    judgments.push({
      kicker: '跟进提示',
      title: firstRelation ? '辅助关系图已形成初步导航' : '建议结合凭证与原文继续复核',
      body: firstRelation
        ? `${firstRelation.source} ${firstRelation.relation} ${firstRelation.target}。辅助关系图适合快速扫清连接，但最终判断仍应以原文与凭证为准。`
        : metadata.importStatus === 'cache'
          ? '当前结果来自缓存回退，适合比赛场景稳定展示，但建议保留人工复核原文语境。'
          : '关系整理已完成，可以结合分析凭证与原文继续判断这条线索是否值得跟进。',
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[2] ?? sentences[1] ?? sentences[0] ?? summary ?? '等待更多原文片段到位。',
      evidenceRoleLine: '参考用途：辅助人工复核主体关系，暂未做逐句证据对齐。',
      meta: [
        formatImportModeLabel(metadata.importMode),
        (session.agentSession?.totals?.successfulRuns ?? session.steps?.filter((step) => step.status === 'completed').length ?? 0) > 0
          ? `${session.agentSession?.totals?.successfulRuns ?? session.steps?.filter((step) => step.status === 'completed').length ?? 0} 次调用`
          : '链路准备中'
      ]
    });
  }

  return judgments;
}

export function createLiveWorkbenchViewModel(
  session: LiveWorkbenchSessionLike | null | undefined,
  supportedSourceLabels: SupportedSourceLabelMap
): LiveWorkbenchViewModel {
  const metadata = getSourceMetadata(session);
  const summaryReady = getStepStatus(session, 'summary') === 'completed';
  const sourceLabel = getDisplaySource(session, supportedSourceLabels);
  const importModeLabel = formatImportModeLabel(metadata.importMode);
  const importStatusLabel = formatImportStatusLabel(metadata.importStatus);
  const eventTypeValue = summaryReady ? `${inferEventType(session)}（初步归类）` : '待识别';
  const importanceValue = summaryReady ? inferImportance(session) : '待判断';
  const sourceModeValue = metadata.sourceSite ? `${sourceLabel} · ${importModeLabel}` : importModeLabel;
  const summary = summaryReady
    ? getSummary(session) || '事件摘要已返回，建议继续结合原文语境复核。'
    : session?.status === 'queued'
      ? 'live session 已创建，正在等待第一条事件判断返回。'
      : session?.status === 'running'
        ? session.mode === 'gateway'
          ? '批量支付与结果处理进行中，工作台会在响应返回后按阶段回放结果。'
          : '事件判断正在生成，主区会按完成顺序逐块填充。'
        : session?.status === 'failed'
          ? '本次分析未完成，建议回看导入来源与分析凭证定位问题。'
          : '选择一条资讯后，系统会先生成事件判断，再补全主体、证据和分析凭证。';

  return {
    headline: getDisplayHeadline(session),
    summary,
    eventTypeValue,
    importanceValue,
    sourceModeValue,
    totalPriceValue: getTotalPrice(session),
    judgments: buildJudgments(session),
    evidenceSectionNote: '当前展示的是相关原文片段，便于人工复核；暂不宣称已完成逐句证据对齐。',
    sourceLabel,
    sourceTypeLabel: session?.source?.sourceType ?? 'news',
    importModeLabel,
    importStatusLabel,
    articleUrl: metadata.articleUrl,
    cachedAt: metadata.cachedAt,
    entities: getEntities(session),
    entityStepStatus: getStepStatus(session, 'entities')
  };
}
