import { describe, expect, it, vi } from 'vitest';

import { LiveNewsPresetProvider } from '../src/demo/live-preset-provider.js';
import { ARC_RECOMMENDED_TRIAL_LINKS, liveNewsPresets } from '../src/demo/news-presets.js';
import type { ImportedArticle } from '../src/domain/news-import/index.js';

const createImportedArticle = (overrides: Partial<ImportedArticle> & Pick<ImportedArticle, 'sourceUrl' | 'sourceSite' | 'title' | 'text'>): ImportedArticle => ({
  sourceType: 'news',
  ...overrides
});

describe('LiveNewsPresetProvider', () => {
  it('should build dynamic Arc-related presets from curated links', async () => {
    const importArticle = vi.fn(async (articleUrl: string) => {
      if (articleUrl === ARC_RECOMMENDED_TRIAL_LINKS[0]) {
        return createImportedArticle({
          sourceUrl: articleUrl,
          sourceSite: 'panews',
          title: 'A Conversation with Circle CEO: Profit Model, Bank Competition, and Arc Chain Strategy',
          text: 'Circle discusses Arc chain strategy and stablecoin settlement infrastructure.',
          excerpt: 'Circle discusses Arc chain strategy.'
        });
      }

      throw new Error(`unexpected url: ${articleUrl}`);
    });
    const provider = new LiveNewsPresetProvider({
      newsImporter: { import: importArticle },
      now: () => 100,
      cacheTtlMs: 10_000
    });

    const presets = await provider.listPresets();

    expect(presets[0]?.title).toContain('Arc Chain Strategy');
    expect(presets[0]?.request.metadata?.importMode).toBe('preset');
    expect(importArticle).toHaveBeenCalledWith(ARC_RECOMMENDED_TRIAL_LINKS[0]);
  });

  it('should fall back to static presets when dynamic import fails', async () => {
    const provider = new LiveNewsPresetProvider({
      newsImporter: {
        import: vi.fn(async () => {
          throw new Error('source unavailable');
        })
      },
      now: () => 100,
      cacheTtlMs: 10_000
    });

    const presets = await provider.listPresets();

    expect(presets).toEqual(liveNewsPresets);
  });

  it('should reuse cached presets within ttl', async () => {
    let currentTime = 100;
    const importArticle = vi.fn(async (articleUrl: string) =>
      createImportedArticle({
        sourceUrl: articleUrl,
        sourceSite: 'chaincatcher',
        title: `cached ${articleUrl}`,
        text: 'Arc dynamic preset cache check.',
        excerpt: 'Arc dynamic preset cache check.'
      })
    );
    const provider = new LiveNewsPresetProvider({
      newsImporter: { import: importArticle },
      now: () => currentTime,
      cacheTtlMs: 10_000
    });

    const first = await provider.listPresets();
    currentTime += 5_000;
    const second = await provider.listPresets();

    expect(second).toEqual(first);
    expect(importArticle).toHaveBeenCalledTimes(ARC_RECOMMENDED_TRIAL_LINKS.length);
  });
});
