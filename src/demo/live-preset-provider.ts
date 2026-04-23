import type { ImportedArticle } from '../domain/news-import/index.js';
import {
  ARC_DYNAMIC_PRESET_SOURCES,
  createLiveNewsPresetFromImportedArticle,
  liveNewsPresets,
  type LiveNewsPreset,
  type LiveNewsPresetSeed
} from './news-presets.js';

type NewsImporter = {
  import: (articleUrl: string) => Promise<ImportedArticle>;
};

type LiveNewsPresetProviderOptions = {
  newsImporter: NewsImporter;
  curatedSources?: LiveNewsPresetSeed[];
  staticPresets?: LiveNewsPreset[];
  cacheTtlMs?: number;
  now?: () => number;
};

type PresetCacheState = {
  expiresAt: number;
  presets: LiveNewsPreset[];
};

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

export class LiveNewsPresetProvider {
  private cacheState: PresetCacheState | null = null;

  private readonly curatedSources: LiveNewsPresetSeed[];

  private readonly staticPresets: LiveNewsPreset[];

  private readonly cacheTtlMs: number;

  private readonly now: () => number;

  constructor(private readonly options: LiveNewsPresetProviderOptions) {
    this.curatedSources = options.curatedSources ?? ARC_DYNAMIC_PRESET_SOURCES;
    this.staticPresets = options.staticPresets ?? liveNewsPresets;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async listPresets(): Promise<LiveNewsPreset[]> {
    if (this.cacheState && this.cacheState.expiresAt > this.now()) {
      return this.cacheState.presets;
    }

    const dynamicPresets = await this.loadDynamicPresets();
    const presets = this.mergePresets(dynamicPresets);

    this.cacheState = {
      presets,
      expiresAt: this.now() + this.cacheTtlMs
    };

    return presets;
  }

  private async loadDynamicPresets(): Promise<LiveNewsPreset[]> {
    const settledResults = await Promise.allSettled(
      this.curatedSources.map(async (seed) => {
        const article = await this.options.newsImporter.import(seed.articleUrl);
        return createLiveNewsPresetFromImportedArticle(seed, article);
      })
    );

    return settledResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }

  private mergePresets(dynamicPresets: LiveNewsPreset[]): LiveNewsPreset[] {
    if (dynamicPresets.length === 0) {
      return this.staticPresets;
    }

    const merged = [...dynamicPresets];
    const seenUrls = new Set(merged.map((preset) => preset.articleUrl));

    for (const preset of this.staticPresets) {
      if (seenUrls.has(preset.articleUrl)) {
        continue;
      }

      merged.push(preset);
      seenUrls.add(preset.articleUrl);
    }

    return merged;
  }
}
