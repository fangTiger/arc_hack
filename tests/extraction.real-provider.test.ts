import { describe, expect, it, vi } from 'vitest';

import { RealKnowledgeExtractionProvider } from '../src/domain/extraction/real-provider.js';

describe('RealKnowledgeExtractionProvider', () => {
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
});
