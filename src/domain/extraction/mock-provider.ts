import type { KnowledgeExtractionProvider } from './provider.js';
import {
  buildFallbackRelations,
  extractStrongEntityHints,
  isWeakSignalRequest,
  normalizeEntities,
  normalizeRelations
} from './normalizer.js';
import type {
  EntityExtractionResult,
  ExtractionEntity,
  ExtractionOperation,
  ExtractionRequest,
  ExtractionResult,
  RelationExtractionResult,
  SummaryExtractionResult
} from './types.js';

type StructuredAnalysisResult = {
  entities: ExtractionEntity[];
  relations: RelationExtractionResult['relations'];
};

const sentencePattern = /[^.!?]+[.!?]?/g;
const getSentences = (request: ExtractionRequest): string[] => {
  const title = request.title?.trim();
  const text = request.text.trim();
  const content = [title, text].filter(Boolean).join('. ');

  return (content.match(sentencePattern) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
};

const buildSummary = (request: ExtractionRequest): SummaryExtractionResult => {
  const sentences = getSentences(request).slice(0, 2);

  return {
    kind: 'summary',
    summary: sentences.join(' ')
  };
};

const buildEntities = (request: ExtractionRequest): EntityExtractionResult => {
  return {
    kind: 'entities',
    entities: normalizeEntities(request, extractStrongEntityHints(request))
  };
};

const inferRelationLabel = (sentence: string, index: number): string => {
  const normalizedSentence = sentence.toLowerCase();

  if (/(partner|合作|联合|共同)/u.test(normalizedSentence)) {
    return 'partners_with';
  }

  if (/(settlement|结算|清算|transfer)/u.test(normalizedSentence)) {
    return 'settles_with';
  }

  if (/(support|支持|merchant|checkout)/u.test(normalizedSentence)) {
    return 'supports';
  }

  if (/(integrat|接入|整合|workflow)/u.test(normalizedSentence)) {
    return 'integrates_with';
  }

  if (/(secure|safety|treasury|custody|风控|托管)/u.test(normalizedSentence)) {
    return 'secures';
  }

  if (/(launch|rollout|expand|asia|singapore|market|部署)/u.test(normalizedSentence)) {
    return 'expands_to';
  }

  return index === 0 ? 'mentions' : '关联';
};

const sentenceIncludesEntity = (sentence: string, entity: ExtractionEntity): boolean => {
  return sentence.toLowerCase().includes(entity.name.toLowerCase());
};

const buildDenseStrongRelations = (
  request: ExtractionRequest,
  entities: ExtractionEntity[]
): RelationExtractionResult['relations'] => {
  const sentences = getSentences(request);
  const primaryEntity = entities[0];
  const contextualRelations: RelationExtractionResult['relations'] = [];

  for (const sentence of sentences) {
    const mentionedEntities = entities.filter((entity) => sentenceIncludesEntity(sentence, entity)).slice(0, 4);

    if (mentionedEntities.length >= 2) {
      for (let index = 0; index < mentionedEntities.length - 1; index += 1) {
        contextualRelations.push({
          source: mentionedEntities[index]!.name,
          relation: inferRelationLabel(sentence, index),
          target: mentionedEntities[index + 1]!.name
        });
      }

      continue;
    }

    if (primaryEntity && mentionedEntities.length === 1 && mentionedEntities[0]!.name !== primaryEntity.name) {
      contextualRelations.push({
        source: primaryEntity.name,
        relation: inferRelationLabel(sentence, 0),
        target: mentionedEntities[0]!.name
      });
    }
  }

  const fallbackRelations = buildFallbackRelations(request, entities);

  if (contextualRelations.length >= 5) {
    return contextualRelations;
  }

  return [...contextualRelations, ...fallbackRelations];
};

const buildStructuredAnalysis = (request: ExtractionRequest): StructuredAnalysisResult => {
  const entities = buildEntities(request).entities;
  const rawRelations =
    !isWeakSignalRequest(request) && entities.length >= 2
      ? entities.length >= 5
        ? buildDenseStrongRelations(request, entities)
        : [
            {
              source: entities[0].name,
              relation: 'mentions',
              target: entities[1].name
            }
          ]
      : [];

  return {
    entities,
    relations: normalizeRelations(request, rawRelations, entities)
  };
};

export class MockKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  private readonly structuredAnalysisCache = new Map<string, StructuredAnalysisResult>();

  private getStructuredAnalysis(request: ExtractionRequest): StructuredAnalysisResult {
    const cacheKey = JSON.stringify({
      sourceType: request.sourceType,
      title: request.title ?? '',
      text: request.text
    });
    const cached = this.structuredAnalysisCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const analysis = buildStructuredAnalysis(request);
    this.structuredAnalysisCache.set(cacheKey, analysis);
    return analysis;
  }

  async extract(operation: ExtractionOperation, request: ExtractionRequest): Promise<ExtractionResult> {
    switch (operation) {
      case 'summary':
        return buildSummary(request);
      case 'entities':
        return {
          kind: 'entities',
          entities: this.getStructuredAnalysis(request).entities
        };
      case 'relations':
        return {
          kind: 'relations',
          relations: this.getStructuredAnalysis(request).relations
        };
      default: {
        const exhaustiveCheck: never = operation;
        throw new Error(`Unsupported extraction operation: ${exhaustiveCheck}`);
      }
    }
  }
}
