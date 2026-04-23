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
  sessionId?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed';
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  failedAt?: string;
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

export type LiveWorkbenchSnapshotLike = Pick<
  LiveWorkbenchSessionLike,
  'sessionId' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt' | 'failedAt'
>;

export type SupportedSourceLabelMap = Partial<Record<SupportedNewsSite, string>>;

export type LiveWorkbenchJudgment = {
  kicker: string;
  title: string;
  body: string;
  previewBody: string;
  evidenceTitle: string;
  evidenceQuote: string;
  previewQuote: string;
  evidenceRoleLine: string;
  meta: string[];
  detailTags: string[];
  detailSourceStatus: string;
  evidenceDetail: {
    currentQuote: string;
    previousQuote?: string;
    nextQuote?: string;
    sourceSite: string;
    importModeLabel: string;
    importStatusLabel: string;
    cachedAt?: string;
    articleUrl?: string;
  };
};

export type LiveWorkbenchViewModel = {
  pageStateLabel: string;
  pageStateTone: 'idle' | 'ready' | 'running' | 'completed' | 'failed';
  pageStateSummary: string;
  phaseLabel: string;
  currentObjectValue: string;
  sourceStatusValue: string;
  runStatusValue: string;
  credentialStatusValue: string;
  nextActionLabel: string;
  nextActionHint: string;
  hasRetainedResult: boolean;
  headline: string;
  summary: string;
  briefing: string;
  fullSummary: string;
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

export function shouldAcceptLiveSnapshot(
  currentSnapshot: LiveWorkbenchSnapshotLike | null | undefined,
  incomingSnapshot: LiveWorkbenchSnapshotLike | null | undefined
): boolean {
  function isTerminalWorkbenchStatus(status: LiveWorkbenchSessionLike['status']): boolean {
    return status === 'completed' || status === 'failed';
  }

  function getWorkbenchSnapshotTimestamp(session: LiveWorkbenchSnapshotLike | null | undefined): number {
    const rawTimestamp =
      session?.updatedAt ?? session?.completedAt ?? session?.failedAt ?? session?.createdAt ?? '';
    const parsedTimestamp = Date.parse(rawTimestamp);
    return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
  }

  function getWorkbenchStatusPriority(status: LiveWorkbenchSessionLike['status']): number {
    switch (status) {
      case 'completed':
        return 4;
      case 'failed':
        return 3;
      case 'running':
        return 2;
      case 'queued':
        return 1;
      default:
        return 0;
    }
  }

  if (!incomingSnapshot) {
    return true;
  }

  if (!currentSnapshot) {
    return true;
  }

  if (
    currentSnapshot.sessionId &&
    incomingSnapshot.sessionId &&
    currentSnapshot.sessionId !== incomingSnapshot.sessionId
  ) {
    return true;
  }

  if (isTerminalWorkbenchStatus(currentSnapshot.status) && !isTerminalWorkbenchStatus(incomingSnapshot.status)) {
    return false;
  }

  if (!isTerminalWorkbenchStatus(currentSnapshot.status) && isTerminalWorkbenchStatus(incomingSnapshot.status)) {
    return true;
  }

  const currentTimestamp = getWorkbenchSnapshotTimestamp(currentSnapshot);
  const incomingTimestamp = getWorkbenchSnapshotTimestamp(incomingSnapshot);

  if (incomingTimestamp < currentTimestamp) {
    return false;
  }

  if (incomingTimestamp === currentTimestamp) {
    return getWorkbenchStatusPriority(incomingSnapshot.status) >= getWorkbenchStatusPriority(currentSnapshot.status);
  }

  return true;
}

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
  const retainedResult = hasRetainedWorkbenchResult(session);
  const summaryReady = getStepStatus(session, 'summary') === 'completed' && getSummary(session).trim();

  if (sourceTitle) {
    return sourceTitle;
  }

  if (retainedResult) {
    return getDisplaySourceTitle(session) ?? '事件判断已生成';
  }

  if (summaryReady) {
    return '事件判断已生成';
  }

  if (session.source?.metadata?.importMode === 'manual') {
    return session.status === 'failed' ? '分析未完成' : '等待事件判断生成';
  }

  return extractSentences(session.source?.text ?? '')[0] ?? '等待事件判断生成';
}

export function getDisplaySourceTitle(session: LiveWorkbenchSessionLike | null | undefined): string | undefined {
  const sourceTitle = session?.source?.title?.trim();

  if (sourceTitle) {
    return sourceTitle;
  }

  const summarySentence = extractSentences(getSummary(session))[0]?.trim();

  if (!summarySentence) {
    return undefined;
  }

  const normalized = summarySentence.replace(/[。！？!?]+$/u, '').trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 48 ? `${normalized.slice(0, 47).trimEnd()}…` : normalized;
}

export function isGeneratedSourceTitle(session: LiveWorkbenchSessionLike | null | undefined): boolean {
  return !session?.source?.title?.trim() && Boolean(getDisplaySourceTitle(session));
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

export function hasStableWorkbenchResult(session: LiveWorkbenchSessionLike | null | undefined): boolean {
  if (!session) {
    return false;
  }

  return Boolean(
    getSummary(session).trim() ||
      getEntities(session).length > 0 ||
      getRelations(session).length > 0 ||
      (session.agentSession?.totals?.successfulRuns ?? 0) > 0
  );
}

export function hasRetainedWorkbenchResult(session: LiveWorkbenchSessionLike | null | undefined): boolean {
  if (!session || (session.status !== 'running' && session.status !== 'failed')) {
    return false;
  }

  if (getStepStatus(session, 'summary') === 'completed') {
    return false;
  }

  return Boolean(
    session.agentSession &&
      (session.agentSession.summary?.trim() ||
        (session.agentSession.entities?.length ?? 0) > 0 ||
        (session.agentSession.relations?.length ?? 0) > 0)
  );
}

export function getPhaseLabel(session: LiveWorkbenchSessionLike | null | undefined): string {
  if (!session) {
    return '尚未进入分析阶段';
  }

  const steps = session.steps ?? [];
  const runningStep = steps.find((step) => step.status === 'running');

  if (runningStep) {
    switch (runningStep.key) {
      case 'summary':
        return '阶段：事件判断生成中';
      case 'entities':
        return '阶段：核心主体抽取中';
      case 'relations':
        return '阶段：证据关系整理中';
      default:
        return `阶段：${runningStep.key}`;
    }
  }

  const failedStep = steps.find((step) => step.status === 'failed');

  if (failedStep) {
    switch (failedStep.key) {
      case 'summary':
        return '阶段：事件判断生成失败';
      case 'entities':
        return '阶段：核心主体抽取失败';
      case 'relations':
        return '阶段：证据关系整理失败';
      default:
        return `阶段：${failedStep.key} 失败`;
    }
  }

  if (session.status === 'completed') {
    return '阶段：分析链路已完成';
  }

  if (session.status === 'queued') {
    return '阶段：等待任务启动';
  }

  return '阶段：等待分析启动';
}

export function getPageStateSummary(session: LiveWorkbenchSessionLike | null | undefined): {
  label: string;
  tone: LiveWorkbenchViewModel['pageStateTone'];
  summary: string;
  nextActionLabel: string;
  nextActionHint: string;
} {
  const retainedResult = hasRetainedWorkbenchResult(session);

  if (!session) {
    return {
      label: '待导入',
      tone: 'idle',
      summary: '待导入：请先在导入仓放入链接、正文或预置样本，工作台会保留主区骨架等待结果进入。',
      nextActionLabel: '导入材料',
      nextActionHint: '从导入仓开始一次新分析。'
    };
  }

  const sourceText = session.source?.text?.trim();
  const metadata = getSourceMetadata(session);
  const readyToAnalyze = Boolean(sourceText || metadata.articleUrl);

  if (session.status === 'queued') {
    return {
      label: '待分析',
      tone: 'ready',
      summary: '待分析：材料已就位，系统正在排队启动本轮分析。',
      nextActionLabel: '等待启动',
      nextActionHint: '保持当前工作台即可，主区会在返回后补齐。'
    };
  }

  if (session.status === 'running') {
    return {
      label: '分析中',
      tone: 'running',
      summary: retainedResult
        ? '分析中：新一轮结果生成中，旧结果会继续保留在当前工作台，直到新结果成功替换。'
        : session.mode === 'gateway'
          ? '分析中：批量支付与结果处理进行中，工作台会在响应返回后按阶段回放结果。'
          : '分析中：事件判断正在生成，主区会按完成顺序逐块填充。',
      nextActionLabel: '等待结果',
      nextActionHint: retainedResult ? '旧结果仍可继续复核。' : '保持当前页面以查看增量更新。'
    };
  }

  if (session.status === 'failed') {
    return {
      label: '分析失败',
      tone: 'failed',
      summary: retainedResult
        ? '分析失败：本轮失败，已保留旧结果与已完成区块，你可以在当前工作台直接重试。'
        : '分析失败：当前结果未能完成，请先检查导入来源、运行状态与分析凭证。',
      nextActionLabel: retainedResult ? '重新分析' : '重试分析',
      nextActionHint: retainedResult ? '旧结果仍保留在主区与侧栏。' : '建议先确认材料与导入方式。'
    };
  }

  if (session.status === 'completed') {
    return {
      label: '分析完成',
      tone: 'completed',
      summary: '分析完成：主区已生成可连续阅读的事件总览、关键判断与证据摘录。',
      nextActionLabel: '重新分析',
      nextActionHint: '可在保留当前上下文的前提下启动新一轮分析。'
    };
  }

  return {
    label: readyToAnalyze ? '待分析' : '待导入',
    tone: readyToAnalyze ? 'ready' : 'idle',
    summary: readyToAnalyze
      ? '待分析：材料已录入，可直接开始本轮分析。'
      : '待导入：请先补充分析材料。',
    nextActionLabel: readyToAnalyze ? '开始分析' : '导入材料',
    nextActionHint: readyToAnalyze ? '工作台会保留骨架并等待结果返回。' : '支持白名单链接、手动文本与预置样本。'
  };
}

export function buildPreviewText(value: string, limit = 92): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
}

export function buildDetailSourceStatus(
  session: LiveWorkbenchSessionLike | null | undefined,
  supportedSourceLabels: SupportedSourceLabelMap
): string {
  const metadata = getSourceMetadata(session);
  const sourceLabel = getDisplaySource(session, supportedSourceLabels);
  const importModeLabel = formatImportModeLabel(metadata.importMode);
  const importStatusLabel = formatImportStatusLabel(metadata.importStatus);

  if (importStatusLabel === '未标记导入状态') {
    return `${sourceLabel} · ${importModeLabel}`;
  }

  return `${sourceLabel} · ${importModeLabel} · ${importStatusLabel}`;
}

export function buildEvidenceDetail(
  session: LiveWorkbenchSessionLike | null | undefined,
  sentences: string[],
  fallbackQuote: string,
  preferredSentenceIndex: number,
  supportedSourceLabels: SupportedSourceLabelMap
): LiveWorkbenchJudgment['evidenceDetail'] {
  const metadata = getSourceMetadata(session);
  const safeSentenceIndex =
    sentences[preferredSentenceIndex] !== undefined
      ? preferredSentenceIndex
      : Math.max(0, Math.min(preferredSentenceIndex, sentences.length - 1));
  const currentQuote = sentences[safeSentenceIndex] ?? fallbackQuote;

  return {
    currentQuote,
    ...(sentences[safeSentenceIndex - 1] ? { previousQuote: sentences[safeSentenceIndex - 1] } : {}),
    ...(sentences[safeSentenceIndex + 1] ? { nextQuote: sentences[safeSentenceIndex + 1] } : {}),
    sourceSite: getDisplaySource(session, supportedSourceLabels),
    importModeLabel: formatImportModeLabel(metadata.importMode),
    importStatusLabel: formatImportStatusLabel(metadata.importStatus),
    ...(metadata.cachedAt ? { cachedAt: metadata.cachedAt } : {}),
    ...(metadata.articleUrl ? { articleUrl: metadata.articleUrl } : {})
  };
}

export function buildJudgments(
  session: LiveWorkbenchSessionLike | null | undefined,
  supportedSourceLabels: SupportedSourceLabelMap = {}
): LiveWorkbenchJudgment[] {
  const retainedResult = hasRetainedWorkbenchResult(session);

  if (!session || (getStepStatus(session, 'summary') !== 'completed' && !retainedResult)) {
    return [];
  }

  const summary = getSummary(session);
  const entities = getEntities(session);
  const relations = getRelations(session);
  const sentences = extractSentences(session.source?.text ?? '');
  const metadata = getSourceMetadata(session);
  const eventType = inferEventType(session);
  const importance = inferImportance(session);
  const sourceStatus = buildDetailSourceStatus(session, supportedSourceLabels);
  const summaryDetailTags = [`${eventType}（初步归类）`, `重要性 ${importance}`];
  const judgments: LiveWorkbenchJudgment[] = [
    {
      kicker: '事件判断',
      title: `初步归类为${eventType}`,
      body: summary || '事件摘要已返回，但仍建议结合原文与凭证继续人工复核。',
      previewBody: buildPreviewText(summary || '事件摘要已返回，但仍建议结合原文与凭证继续人工复核。'),
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[0] ?? summary ?? '等待原文片段到位。',
      previewQuote: buildPreviewText(sentences[0] ?? summary ?? '等待原文片段到位。'),
      evidenceRoleLine: '参考用途：辅助人工复核事件判断，暂未做逐句证据对齐。',
      meta: summaryDetailTags,
      detailTags: summaryDetailTags,
      detailSourceStatus: sourceStatus,
      evidenceDetail: buildEvidenceDetail(
        session,
        sentences,
        sentences[0] ?? summary ?? '等待原文片段到位。',
        0,
        supportedSourceLabels
      )
    }
  ];

  if (getStepStatus(session, 'entities') === 'completed' || retainedResult) {
    const entityNames = entities.slice(0, 3).map((entity) => entity.name);
    const entityDetailTags = [
      entities.length > 0 ? `${entities.length} 个主体` : '主体待确认',
      getStepStatus(session, 'relations') === 'completed' || retainedResult ? `${relations.length} 条关系` : '关系待补全'
    ];
    judgments.push({
      kicker: '主体判断',
      title: entityNames.length > 0 ? `优先关注 ${entityNames.slice(0, 2).join(' / ')}` : '暂未识别到稳定主体',
      body:
        entityNames.length > 0
          ? `已识别 ${entities.length} 个主体，适合先确认它们在原文里的角色，再决定是否继续跟进。`
          : '实体抽取已完成，但仍建议结合原文上下文确认主体角色。',
      previewBody: buildPreviewText(
        entityNames.length > 0
          ? `已识别 ${entities.length} 个主体，适合先确认它们在原文里的角色，再决定是否继续跟进。`
          : '实体抽取已完成，但仍建议结合原文上下文确认主体角色。'
      ),
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[1] ?? sentences[0] ?? summary ?? '等待主体相关片段到位。',
      previewQuote: buildPreviewText(sentences[1] ?? sentences[0] ?? summary ?? '等待主体相关片段到位。'),
      evidenceRoleLine: '参考用途：辅助人工复核核心主体，暂未做逐句证据对齐。',
      meta: entityDetailTags,
      detailTags: entityDetailTags,
      detailSourceStatus: sourceStatus,
      evidenceDetail: buildEvidenceDetail(
        session,
        sentences,
        sentences[1] ?? sentences[0] ?? summary ?? '等待主体相关片段到位。',
        sentences[1] ? 1 : 0,
        supportedSourceLabels
      )
    });
  }

  if (getStepStatus(session, 'relations') === 'completed' || retainedResult) {
    const firstRelation = relations[0];
    const relationDetailTags = [
      formatImportModeLabel(metadata.importMode),
      (session.agentSession?.totals?.successfulRuns ?? session.steps?.filter((step) => step.status === 'completed').length ?? 0) > 0
        ? `${session.agentSession?.totals?.successfulRuns ?? session.steps?.filter((step) => step.status === 'completed').length ?? 0} 次调用`
        : '链路准备中'
    ];
    judgments.push({
      kicker: '跟进提示',
      title: firstRelation ? '辅助关系图已形成初步导航' : '建议结合凭证与原文继续复核',
      body: firstRelation
        ? `${firstRelation.source} ${firstRelation.relation} ${firstRelation.target}。辅助关系图适合快速扫清连接，但最终判断仍应以原文与凭证为准。`
        : metadata.importStatus === 'cache'
          ? '当前结果来自缓存回退，可稳定复看，但建议保留人工复核原文语境。'
          : '关系整理已完成，可以结合分析凭证与原文继续判断这条线索是否值得跟进。',
      previewBody: buildPreviewText(
        firstRelation
          ? `${firstRelation.source} ${firstRelation.relation} ${firstRelation.target}。辅助关系图适合快速扫清连接，但最终判断仍应以原文与凭证为准。`
          : metadata.importStatus === 'cache'
            ? '当前结果来自缓存回退，可稳定复看，但建议保留人工复核原文语境。'
            : '关系整理已完成，可以结合分析凭证与原文继续判断这条线索是否值得跟进。'
      ),
      evidenceTitle: '相关原文片段',
      evidenceQuote: sentences[2] ?? sentences[1] ?? sentences[0] ?? summary ?? '等待更多原文片段到位。',
      previewQuote: buildPreviewText(sentences[2] ?? sentences[1] ?? sentences[0] ?? summary ?? '等待更多原文片段到位。'),
      evidenceRoleLine: '参考用途：辅助人工复核主体关系，暂未做逐句证据对齐。',
      meta: relationDetailTags,
      detailTags: relationDetailTags,
      detailSourceStatus: sourceStatus,
      evidenceDetail: buildEvidenceDetail(
        session,
        sentences,
        sentences[2] ?? sentences[1] ?? sentences[0] ?? summary ?? '等待更多原文片段到位。',
        sentences[2] ? 2 : sentences[1] ? 1 : 0,
        supportedSourceLabels
      )
    });
  }

  return judgments;
}

export function createLiveWorkbenchViewModel(
  session: LiveWorkbenchSessionLike | null | undefined,
  supportedSourceLabels: SupportedSourceLabelMap
): LiveWorkbenchViewModel {
  const metadata = getSourceMetadata(session);
  const retainedResult = hasRetainedWorkbenchResult(session);
  const summaryReady = getStepStatus(session, 'summary') === 'completed' || retainedResult;
  const pageState = getPageStateSummary(session);
  const sourceLabel = getDisplaySource(session, supportedSourceLabels);
  const importModeLabel = formatImportModeLabel(metadata.importMode);
  const importStatusLabel = formatImportStatusLabel(metadata.importStatus);
  const eventTypeValue = summaryReady ? `${inferEventType(session)}（初步归类）` : '待识别';
  const importanceValue = summaryReady ? inferImportance(session) : '待判断';
  const sourceModeValue = metadata.sourceSite ? `${sourceLabel} · ${importModeLabel}` : importModeLabel;
  const rawSummary = getSummary(session).trim();
  const summarySentences = extractSentences(rawSummary);
  const fullSummary = summaryReady ? rawSummary || '事件摘要已返回，建议继续结合原文语境复核。' : '';
  const briefing = summaryReady
    ? (() => {
        const compactSummary = summarySentences.slice(0, 2).join(' ').trim() || fullSummary;

        if (!compactSummary) {
          return '事件摘要已返回，建议继续结合原文语境复核。';
        }

        return compactSummary.length > 140 ? `${compactSummary.slice(0, 139).trimEnd()}…` : compactSummary;
      })()
    : pageState.summary;
  const hasSourceTitle = Boolean(session?.source?.title?.trim());
  const summary = retainedResult
    ? pageState.summary
    : summaryReady
    ? hasSourceTitle
      ? briefing
      : '正文分析已完成，可在下方查看关键判断与证据摘录。'
    : pageState.summary;
  const successfulRuns = session?.agentSession?.totals?.successfulRuns ?? session?.steps?.filter((step) => step.status === 'completed').length ?? 0;
  const credentialStatusValue =
    session?.status === 'failed'
      ? successfulRuns > 0
        ? `已有 ${successfulRuns} 条凭证可复核`
        : '本轮未形成可复核凭证'
      : successfulRuns > 0
        ? `${successfulRuns} 条凭证已回填`
        : '待生成凭证';
  const sourceStatusValue =
    session == null
      ? '待导入'
      : importStatusLabel === '未标记导入状态'
        ? `${importModeLabel} · 来源待确认`
        : `${importModeLabel} · ${importStatusLabel}`;
  const currentObjectValue = getDisplaySourceTitle(session) ?? getDisplayHeadline(session);
  const runStatusValue = `${pageState.label} · ${getPhaseLabel(session).replace(/^阶段：/, '')}`;

  return {
    pageStateLabel: pageState.label,
    pageStateTone: pageState.tone,
    pageStateSummary: pageState.summary,
    phaseLabel: getPhaseLabel(session),
    currentObjectValue,
    sourceStatusValue,
    runStatusValue,
    credentialStatusValue,
    nextActionLabel: pageState.nextActionLabel,
    nextActionHint: pageState.nextActionHint,
    hasRetainedResult: retainedResult,
    headline: getDisplayHeadline(session),
    summary,
    briefing,
    fullSummary,
    eventTypeValue,
    importanceValue,
    sourceModeValue,
    totalPriceValue: getTotalPrice(session),
    judgments: buildJudgments(session, supportedSourceLabels),
    evidenceSectionNote: retainedResult
      ? session?.status === 'failed'
        ? '本轮失败，已保留上一版证据摘录与失败反馈，便于继续人工复核；暂不宣称已完成逐句证据对齐。'
        : '当前展示的是上一版证据摘录；新结果生成期间会继续保留它们供人工复核，直到新结果成功替换。'
      : '当前展示的是相关原文片段，便于人工复核；暂不宣称已完成逐句证据对齐。',
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
