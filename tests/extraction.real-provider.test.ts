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

  it('should reuse one structured analysis response across entities and relations for the same request', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [
                    { name: 'Arc', type: 'organization' },
                    { name: 'Circle', type: 'organization' }
                  ],
                  relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
                })
              }
            }
          ]
        })
      });
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    await expect(provider.extract('entities', strongEntityRequest)).resolves.toEqual({
      kind: 'entities',
      entities: [
        { name: 'Arc', type: 'organization' },
        { name: 'Circle', type: 'organization' }
      ]
    });
    await expect(provider.extract('relations', strongEntityRequest)).resolves.toEqual({
      kind: 'relations',
      relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('should keep richer entity and relation sets for strong texts and ask the model for denser structured analysis', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [
                  { name: 'Arc', type: 'organization' },
                  { name: 'Circle', type: 'organization' },
                  { name: 'USDC', type: 'topic' },
                  { name: 'AI agents', type: 'topic' },
                  { name: 'Settlement layer', type: 'topic' },
                  { name: 'Gasless payments', type: 'topic' },
                  { name: 'Gateway buyer', type: 'topic' },
                  { name: 'Machine-pay flows', type: 'topic' },
                  { name: 'Asia market', type: 'topic' }
                ],
                relations: [
                  { source: 'Arc', relation: 'partners_with', target: 'Circle' },
                  { source: 'Circle', relation: 'settles', target: 'USDC' },
                  { source: 'Arc', relation: 'serves', target: 'AI agents' },
                  { source: 'Arc', relation: 'supports', target: 'Gasless payments' },
                  { source: 'Circle', relation: 'powers', target: 'Settlement layer' },
                  { source: 'Gateway buyer', relation: 'connects_to', target: 'Arc' },
                  { source: 'Gateway buyer', relation: 'uses', target: 'USDC' },
                  { source: 'Machine-pay flows', relation: 'targets', target: 'AI agents' },
                  { source: 'Machine-pay flows', relation: 'settles_with', target: 'Settlement layer' },
                  { source: 'Gateway buyer', relation: 'routes', target: 'Machine-pay flows' },
                  { source: 'Circle', relation: 'supports', target: 'Machine-pay flows' }
                ]
              })
            }
          }
        ]
      })
    });
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    const entitiesResult = await provider.extract('entities', strongEntityRequest);
    const relationsResult = await provider.extract('relations', strongEntityRequest);
    const requestBody = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    const systemInstruction = requestBody.messages?.[0]?.content ?? '';

    expect(entitiesResult.kind).toBe('entities');
    if (entitiesResult.kind !== 'entities') {
      throw new Error('Expected entities result.');
    }
    expect(entitiesResult.entities).toHaveLength(8);
    expect(entitiesResult.entities.map((entity) => entity.name)).toEqual([
      'Arc',
      'Circle',
      'USDC',
      'AI agents',
      'Settlement layer',
      'Gasless payments',
      'Gateway buyer',
      'Machine-pay flows'
    ]);

    expect(relationsResult.kind).toBe('relations');
    if (relationsResult.kind !== 'relations') {
      throw new Error('Expected relations result.');
    }
    expect(relationsResult.relations).toHaveLength(10);
    expect(systemInstruction).toContain('entities 最多 8 个');
    expect(systemInstruction).toContain('relations 最多 10 条');
  });

  it('should evict a failed structured analysis cache entry so later retries can recover', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'temporary failure'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [
                    { name: 'Arc', type: 'organization' },
                    { name: 'Circle', type: 'organization' }
                  ],
                  relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
                })
              }
            }
          ]
        })
      });
    const provider = new RealKnowledgeExtractionProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    await expect(provider.extract('entities', strongEntityRequest)).rejects.toThrow('status 500');
    await expect(provider.extract('relations', strongEntityRequest)).resolves.toEqual({
      kind: 'relations',
      relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
