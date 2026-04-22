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

const buildRelations = (request: ExtractionRequest): RelationExtractionResult => {
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
    kind: 'relations',
    relations: normalizeRelations(request, rawRelations, entities)
  };
};

export class MockKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  async extract(operation: ExtractionOperation, request: ExtractionRequest): Promise<ExtractionResult> {
    switch (operation) {
      case 'summary':
        return buildSummary(request);
      case 'entities':
        return buildEntities(request);
      case 'relations':
        return buildRelations(request);
      default: {
        const exhaustiveCheck: never = operation;
        throw new Error(`Unsupported extraction operation: ${exhaustiveCheck}`);
      }
    }
  }
}
