import type {
  EntityExtractionResult,
  ExtractionEntity,
  ExtractionOperation,
  ExtractionRelation,
  ExtractionRequest,
  ExtractionResult,
  RelationExtractionResult
} from './types.js';

const MAX_STRONG_ENTITY_COUNT = 8;
const MAX_WEAK_ENTITY_COUNT = 4;
const MIN_WEAK_ENTITY_COUNT = 2;
const MAX_STRONG_RELATION_COUNT = 10;
const MAX_WEAK_RELATION_COUNT = 3;
const WEAK_RELATION_LABELS = ['日期', '状态', '描述', '提到'] as const;
const STRONG_ENTITY_TOKEN_PATTERN = /\b[A-Z][a-zA-Z]{1,}\b/g;
const WEAK_SIGNAL_CUE_PATTERN = /今天|昨天|明天|星期[一二三四五六日天]|周[一二三四五六日天]|天气|没啥特别|没什么特别|日常|普通|一般|不错/u;
const TEMPORAL_PATTERN = /今天|昨天|明天|今晚|今早|今晨|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}日|\d{1,2}号/gu;
const WEATHER_PATTERN = /天气不错|天气很好|天气|晴天|多云|下雨|阴天|晴朗|凉快|炎热/gu;
const STATE_PATTERN = /没啥特别的了|没什么特别的了|没啥特别|没什么特别|不错|平静|日常|普通|一般|顺利|忙碌/gu;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const dedupeByName = <Item extends { name: string }>(items: Item[]): Item[] => {
  const seen = new Set<string>();
  const deduped: Item[] = [];

  for (const item of items) {
    const normalizedName = normalizeWhitespace(item.name);

    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    deduped.push({
      ...item,
      name: normalizedName
    });
  }

  return deduped;
};

const collectMatches = (source: string, pattern: RegExp, normalize: (value: string) => string = normalizeWhitespace): string[] => {
  const matches = source.match(pattern) ?? [];
  return dedupeByName(matches.map((name) => ({ name: normalize(name) }))).map((item) => item.name);
};

const getSourceText = (request: ExtractionRequest): string => [request.title, request.text].filter(Boolean).join(' ');

const normalizeWeakTopic = (value: string): string => {
  const normalized = normalizeWhitespace(value);

  if (/没啥特别|没什么特别/u.test(normalized)) {
    return '日常状态';
  }

  if (normalized === '不错') {
    return '状态不错';
  }

  return normalized;
};

const extractWeakTopicCandidates = (request: ExtractionRequest): string[] => {
  const source = getSourceText(request);
  const sentenceFragments = source
    .split(/[，,。！？!?；;、]/u)
    .map((fragment) => normalizeWeakTopic(fragment))
    .filter((fragment) => fragment.length >= 2 && fragment.length <= 8);
  const candidates = [
    ...collectMatches(source, TEMPORAL_PATTERN, normalizeWeakTopic),
    ...collectMatches(source, WEATHER_PATTERN, normalizeWeakTopic),
    ...collectMatches(source, STATE_PATTERN, normalizeWeakTopic),
    ...sentenceFragments
  ];
  const dedupedCandidates = dedupeByName(candidates.map((name) => ({ name }))).map((item) => item.name);

  while (dedupedCandidates.length < MIN_WEAK_ENTITY_COUNT) {
    dedupedCandidates.push(dedupedCandidates.length === 0 ? '今日观察' : '日常状态');
  }

  return dedupedCandidates.slice(0, MAX_WEAK_ENTITY_COUNT);
};

export const extractStrongEntityHints = (request: ExtractionRequest): ExtractionEntity[] => {
  const titleMatches = request.title?.match(STRONG_ENTITY_TOKEN_PATTERN) ?? [];
  const textMatches = request.text.match(STRONG_ENTITY_TOKEN_PATTERN) ?? [];
  const filteredMatches = [...titleMatches, ...textMatches].filter((token) => !(token === token.toUpperCase() && token.length <= 4));

  return dedupeByName(filteredMatches.map((name) => ({ name, type: 'organization' as const }))).slice(
    0,
    MAX_STRONG_ENTITY_COUNT
  );
};

export const isWeakSignalRequest = (request: ExtractionRequest): boolean => {
  if (extractStrongEntityHints(request).length >= 2) {
    return false;
  }

  const source = getSourceText(request);
  const sentenceCount = source.split(/[。！？!?]/u).filter((segment) => normalizeWhitespace(segment)).length;

  return WEAK_SIGNAL_CUE_PATTERN.test(source) || (normalizeWhitespace(source).length <= 48 && sentenceCount <= 2);
};

export const buildFallbackEntities = (request: ExtractionRequest): ExtractionEntity[] => {
  const strongHints = extractStrongEntityHints(request);

  if (strongHints.length >= 2 && !isWeakSignalRequest(request)) {
    return strongHints.slice(0, MAX_STRONG_ENTITY_COUNT);
  }

  return extractWeakTopicCandidates(request).map((name) => ({
    name,
    type: 'topic'
  }));
};

const createWeakRelations = (entities: ExtractionEntity[]): ExtractionRelation[] => {
  const names = entities.map((entity) => entity.name);
  const today = names.find((name) => name === '今天');
  const temporal = names.find((name) => /星期|周[一二三四五六日天]|\d{1,2}月\d{1,2}日|\d{1,2}号/u.test(name));
  const weather = names.find((name) => /天气|晴|雨|阴|凉快|炎热|不错/u.test(name));
  const state = names.find((name) => /日常|状态|普通|一般|顺利|忙碌/u.test(name));
  const relations: ExtractionRelation[] = [];

  if (today && temporal) {
    relations.push({
      source: today,
      relation: '日期',
      target: temporal
    });
  } else if (names.length >= 2) {
    relations.push({
      source: names[0],
      relation: '提到',
      target: names[1]
    });
  }

  if (weather) {
    relations.push({
      source: temporal ?? names[0] ?? weather,
      relation: '状态',
      target: weather
    });
  }

  if (state) {
    relations.push({
      source: weather ?? temporal ?? names[0] ?? state,
      relation: '描述',
      target: state
    });
  } else if (names.length >= 3) {
    relations.push({
      source: names[1],
      relation: '描述',
      target: names[2]
    });
  }

  return relations.slice(0, MAX_WEAK_RELATION_COUNT);
};

const buildStrongFallbackRelations = (entities: ExtractionEntity[]): ExtractionRelation[] => {
  const primaryEntity = entities.find((entity) => entity.type !== 'topic') ?? entities[0];

  if (!primaryEntity) {
    return [];
  }

  return entities
    .filter((entity) => entity.name !== primaryEntity.name)
    .slice(0, MAX_STRONG_RELATION_COUNT)
    .map((entity, index) => ({
      source: primaryEntity.name,
      relation: index === 0 ? 'mentions' : '关联',
      target: entity.name
    }));
};

export const buildFallbackRelations = (request: ExtractionRequest, entities: ExtractionEntity[] = buildFallbackEntities(request)): ExtractionRelation[] => {
  if (!isWeakSignalRequest(request)) {
    const strongEntities = entities.filter((entity) => entity.type !== 'topic');

    if (strongEntities.length >= 2) {
      return buildStrongFallbackRelations(entities);
    }
  }

  return createWeakRelations(entities);
};

const normalizeEntityType = (type: unknown): ExtractionEntity['type'] =>
  type === 'organization' || type === 'person' || type === 'topic' ? type : 'topic';

export const normalizeEntities = (
  request: ExtractionRequest,
  entities: EntityExtractionResult['entities']
): EntityExtractionResult['entities'] => {
  const strongHints = extractStrongEntityHints(request);
  const strongHintTypeByName = new Map(strongHints.map((entity) => [entity.name, entity.type]));
  let normalizedEntities = dedupeByName(
    entities.map((entity) => ({
      name: entity.name,
      type: strongHintTypeByName.get(normalizeWhitespace(entity.name)) ?? normalizeEntityType(entity.type)
    }))
  );

  if (isWeakSignalRequest(request)) {
    normalizedEntities = normalizedEntities.map((entity) => ({
      name: entity.name,
      type: 'topic'
    }));

    if (normalizedEntities.length < MIN_WEAK_ENTITY_COUNT) {
      return buildFallbackEntities(request);
    }

    return normalizedEntities.slice(0, MAX_WEAK_ENTITY_COUNT);
  }

  if (strongHints.length >= 2) {
    const normalizedNameSet = new Set(normalizedEntities.map((entity) => entity.name));

    for (const strongHint of strongHints) {
      if (!normalizedNameSet.has(strongHint.name)) {
        normalizedEntities.unshift(strongHint);
        normalizedNameSet.add(strongHint.name);
      }
    }

    normalizedEntities = normalizedEntities.map((entity) => ({
      ...entity,
      type: strongHintTypeByName.get(entity.name) ?? entity.type
    }));
  }

  if (normalizedEntities.length === 0) {
    return buildFallbackEntities(request);
  }

  return normalizedEntities.slice(0, MAX_STRONG_ENTITY_COUNT);
};

const normalizeWeakRelationLabel = (label: string, index: number): string => {
  if ((WEAK_RELATION_LABELS as readonly string[]).includes(label)) {
    return label;
  }

  return WEAK_RELATION_LABELS[Math.min(index, WEAK_RELATION_LABELS.length - 1)];
};

export const normalizeRelations = (
  request: ExtractionRequest,
  relations: RelationExtractionResult['relations'],
  entities: ExtractionEntity[]
): RelationExtractionResult['relations'] => {
  const entityNameSet = new Set(entities.map((entity) => entity.name));
  const normalizedRelations = relations
    .map((relation, index) => ({
      source: normalizeWhitespace(relation.source),
      relation: normalizeWhitespace(relation.relation),
      target: normalizeWhitespace(relation.target),
      index
    }))
    .filter((relation) => relation.source && relation.relation && relation.target)
    .filter((relation) => relation.source !== relation.target)
    .filter((relation) => entityNameSet.size === 0 || (entityNameSet.has(relation.source) && entityNameSet.has(relation.target)))
    .map((relation) => ({
      source: relation.source,
      relation: isWeakSignalRequest(request) ? normalizeWeakRelationLabel(relation.relation, relation.index) : relation.relation,
      target: relation.target
    }));
  const dedupedRelations: ExtractionRelation[] = [];
  const seen = new Set<string>();

  for (const relation of normalizedRelations) {
    const key = `${relation.source}::${relation.relation}::${relation.target}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedRelations.push(relation);
  }

  if (dedupedRelations.length === 0) {
    return buildFallbackRelations(request, entities);
  }

  return dedupedRelations.slice(0, isWeakSignalRequest(request) ? MAX_WEAK_RELATION_COUNT : MAX_STRONG_RELATION_COUNT);
};

export const normalizeExtractionResult = (
  operation: ExtractionOperation,
  request: ExtractionRequest,
  result: ExtractionResult
): ExtractionResult => {
  if (result.kind !== operation) {
    throw new Error(`Expected ${operation} result but received ${result.kind}.`);
  }

  if (operation === 'summary') {
    return result;
  }

  if (operation === 'entities') {
    const entityResult = result as EntityExtractionResult;

    return {
      kind: 'entities',
      entities: normalizeEntities(request, entityResult.entities)
    };
  }

  const relationResult = result as RelationExtractionResult;

  return {
    kind: 'relations',
    relations: normalizeRelations(request, relationResult.relations, normalizeEntities(request, []))
  };
};
