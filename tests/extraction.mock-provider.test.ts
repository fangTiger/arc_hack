import { describe, expect, it } from 'vitest';

import { MockKnowledgeExtractionProvider } from '../src/domain/extraction/mock-provider.js';
import { RealKnowledgeExtractionProvider } from '../src/domain/extraction/real-provider.js';
import type { ExtractionRequest } from '../src/domain/extraction/types.js';

const request: ExtractionRequest = {
  sourceType: 'news',
  title: 'Arc partners with Circle',
  text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
};

describe('MockKnowledgeExtractionProvider', () => {
  it('should return stable structures for summary entities and relations', async () => {
    const provider = new MockKnowledgeExtractionProvider();

    await expect(provider.extract('summary', request)).resolves.toEqual({
      kind: 'summary',
      summary: 'Arc partners with Circle. Arc introduced gasless nanopayments for AI agents.'
    });

    await expect(provider.extract('entities', request)).resolves.toEqual({
      kind: 'entities',
      entities: [
        { name: 'Arc', type: 'organization' },
        { name: 'Circle', type: 'organization' }
      ]
    });

    await expect(provider.extract('relations', request)).resolves.toEqual({
      kind: 'relations',
      relations: [
        { source: 'Arc', relation: 'mentions', target: 'Circle' }
      ]
    });
  });
});

describe('RealKnowledgeExtractionProvider', () => {
  it('should throw a clear error when not configured', async () => {
    const provider = new RealKnowledgeExtractionProvider();

    await expect(provider.extract('summary', request)).rejects.toThrow(
      'Real knowledge extraction provider is not configured.'
    );
  });
});
