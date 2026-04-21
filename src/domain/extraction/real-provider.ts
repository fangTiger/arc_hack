import type { KnowledgeExtractionProvider } from './provider.js';
import type {
  ExtractionOperation,
  ExtractionRequest,
  ExtractionResult
} from './types.js';

export class RealKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  async extract(_operation: ExtractionOperation, _request: ExtractionRequest): Promise<ExtractionResult> {
    throw new Error('Real knowledge extraction provider is not configured.');
  }
}
