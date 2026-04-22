import { describe, expect, it, vi } from 'vitest';

import { MockKnowledgeExtractionProvider } from '../src/domain/extraction/mock-provider.js';
import { RealKnowledgeExtractionProvider } from '../src/domain/extraction/real-provider.js';
import type { ExtractionRequest } from '../src/domain/extraction/types.js';

const request: ExtractionRequest = {
  sourceType: 'news',
  title: 'Arc partners with Circle',
  text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
};

const weakSignalRequest: ExtractionRequest = {
  sourceType: 'news',
  text: '今天星期三，天气不错，没啥特别的了。'
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

  it('should return limited topic entities and weak relations for low-signal text', async () => {
    const provider = new MockKnowledgeExtractionProvider();

    const entitiesResult = await provider.extract('entities', weakSignalRequest);
    const relationsResult = await provider.extract('relations', weakSignalRequest);

    expect(entitiesResult.kind).toBe('entities');
    if (entitiesResult.kind !== 'entities') {
      throw new Error('Expected entities result.');
    }
    expect(entitiesResult.entities.length).toBeGreaterThanOrEqual(2);
    expect(entitiesResult.entities.length).toBeLessThanOrEqual(4);
    expect(entitiesResult.entities.every((entity) => entity.type === 'topic')).toBe(true);
    expect(entitiesResult.entities.some((entity) => /星期三|天气|不错|日常|平静/.test(entity.name))).toBe(true);

    expect(relationsResult.kind).toBe('relations');
    if (relationsResult.kind !== 'relations') {
      throw new Error('Expected relations result.');
    }
    expect(relationsResult.relations.length).toBeGreaterThanOrEqual(1);
    expect(relationsResult.relations.length).toBeLessThanOrEqual(3);
    expect(relationsResult.relations.every((relation) => ['日期', '状态', '描述', '提到'].includes(relation.relation))).toBe(true);
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
