import type {
  ExtractionOperation,
  ExtractionRequest,
  ExtractionResult
} from './types.js';

export interface KnowledgeExtractionProvider {
  extract(operation: ExtractionOperation, request: ExtractionRequest): Promise<ExtractionResult>;
}
