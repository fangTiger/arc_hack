import { describe, expect, it, vi } from 'vitest';

import { RealKnowledgeExtractionProvider } from '../src/domain/extraction/real-provider.js';

describe('RealKnowledgeExtractionProvider', () => {
  const weakSignalRequest = {
    sourceType: 'news' as const,
    text: '今天星期三，天气不错，没啥特别的了。'
  };
  const strongEntityRequest = {
    sourceType: 'news' as const,
    title: 'Arc partners with Circle',
    text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
  };

  it('should normalize a full chat completions URL before sending the request', async () => {
    const fetchImplementation = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: 'summary',
                summary: 'Arc introduced gasless nanopayments.'
              })
            }
          }
        ]
      })
    }));
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-5.4',
      apiKey: 'test-key',
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    const result = await provider.extract('summary', {
      sourceType: 'news',
      title: 'Arc test',
      text: 'Arc introduced gasless nanopayments for AI agents.'
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST'
      })
    );
    expect(result).toEqual({
      kind: 'summary',
      summary: 'Arc introduced gasless nanopayments.'
    });
  });

  it('should include response body details when the upstream request fails', async () => {
    const fetchImplementation = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        error: {
          message: 'Rate limit reached for gpt-5.4'
        }
      })
    }));
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiKey: 'test-key',
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    await expect(
      provider.extract('summary', {
        sourceType: 'news',
        title: 'Arc test',
        text: 'Arc introduced gasless nanopayments for AI agents.'
      })
    ).rejects.toThrow('status 429');
    await expect(
      provider.extract('summary', {
        sourceType: 'news',
        title: 'Arc test',
        text: 'Arc introduced gasless nanopayments for AI agents.'
      })
    ).rejects.toThrow('Rate limit reached for gpt-5.4');
  });

  it('should fallback to 2-4 topic entities when weak text returns empty entities', async () => {
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: 'entities',
                  entities: []
                })
              }
            }
          ]
        })
      }) as typeof fetch
    });

    const result = await provider.extract('entities', weakSignalRequest);

    expect(result.kind).toBe('entities');
    if (result.kind !== 'entities') {
      throw new Error('Expected entities result.');
    }
    expect(result.entities.length).toBeGreaterThanOrEqual(2);
    expect(result.entities.length).toBeLessThanOrEqual(4);
    expect(result.entities.every((entity) => entity.type === 'topic')).toBe(true);
  });

  it('should fallback to 1-3 weak relations when weak text returns empty relations', async () => {
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: 'relations',
                  relations: []
                })
              }
            }
          ]
        })
      }) as typeof fetch
    });

    const result = await provider.extract('relations', weakSignalRequest);

    expect(result.kind).toBe('relations');
    if (result.kind !== 'relations') {
      throw new Error('Expected relations result.');
    }
    expect(result.relations.length).toBeGreaterThanOrEqual(1);
    expect(result.relations.length).toBeLessThanOrEqual(3);
    expect(result.relations.every((relation) => ['日期', '状态', '描述', '提到'].includes(relation.relation))).toBe(true);
  });

  it('should preserve strong entity orientation instead of downgrading everything to topic', async () => {
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: 'entities',
                  entities: [
                    { name: 'Arc', type: 'topic' },
                    { name: 'Circle', type: 'topic' }
                  ]
                })
              }
            }
          ]
        })
      }) as typeof fetch
    });

    const result = await provider.extract('entities', strongEntityRequest);

    expect(result).toEqual({
      kind: 'entities',
      entities: [
        { name: 'Arc', type: 'organization' },
        { name: 'Circle', type: 'organization' }
      ]
    });
  });
});
