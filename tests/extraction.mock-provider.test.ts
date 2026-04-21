import { describe, expect, it, vi } from 'vitest';

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
  it('should call a configured LLM endpoint and parse the JSON result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: 'relations',
                relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
              })
            }
          }
        ]
      })
    });
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://llm.example.com/v1',
      model: 'gpt-test',
      apiKey: 'secret',
      fetchImplementation: fetchMock as typeof fetch
    });

    await expect(provider.extract('relations', request)).resolves.toEqual({
      kind: 'relations',
      relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret'
        })
      })
    );
  });

  it('should throw a clear error when the LLM response is invalid', async () => {
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://llm.example.com/v1',
      model: 'gpt-test',
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'not-json'
              }
            }
          ]
        })
      }) as typeof fetch
    });

    await expect(provider.extract('summary', request)).rejects.toThrow(
      'Real knowledge extraction provider returned invalid JSON content.'
    );
  });
});
