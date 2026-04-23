import type { KnowledgeExtractionProvider } from './provider.js';
import {
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

const buildStructuredAnalysis = (request: ExtractionRequest): StructuredAnalysisResult => {
  const entities = buildEntities(request).entities;
  const rawRelations =
    !isWeakSignalRequest(request) && entities.length >= 2
      ? [
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
