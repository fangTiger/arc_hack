import { join } from 'node:path';

import {
  ArticleFetcher,
  NEWS_IMPORT_MAX_TEXT_LENGTH
} from './article-fetcher.js';
import { detectWhitelistedNewsSource } from './source-detector.js';
import { extractImportedArticle } from './site-extractors/index.js';
import type { ImportedArticle, NewsImportServiceOptions } from './types.js';
import { FileNewsImportCacheStore, normalizeNewsImportUrl } from '../../store/news-import-cache-store.js';

export class WhitelistNewsSourceImporter {
  private readonly articleFetcher: ArticleFetcher;
  private readonly maxTextLength: number;
  private readonly cacheStore: FileNewsImportCacheStore;

  constructor(options: NewsImportServiceOptions = {}) {
    this.articleFetcher = new ArticleFetcher(options);
    this.maxTextLength = options.maxTextLength ?? NEWS_IMPORT_MAX_TEXT_LENGTH;
    this.cacheStore = new FileNewsImportCacheStore(
      options.cacheRootDirectory ?? join(process.cwd(), 'artifacts', 'news-import-cache')
    );
  }

  async import(articleUrl: string): Promise<ImportedArticle> {
    const detectedSource = detectWhitelistedNewsSource(articleUrl);
    try {
      const fetchedArticle = await this.articleFetcher.fetch(detectedSource.url);
      const importedArticle = extractImportedArticle({
        sourceUrl: detectedSource.url.toString(),
        sourceSite: fetchedArticle.sourceSite,
        html: fetchedArticle.html,
        maxTextLength: this.maxTextLength
      });
      const canonicalUrl = normalizeNewsImportUrl(fetchedArticle.finalUrl);
      const cachedAt = new Date().toISOString();

      await this.cacheStore.write({
        ...importedArticle,
        canonicalUrl,
        cachedAt
      });

      return {
        ...importedArticle,
        canonicalUrl,
        importStatus: 'live'
      };
    } catch (error) {
      const cachedArticle = await this.cacheStore.read(detectedSource.url).catch(() => null);

      if (cachedArticle) {
        return {
          ...cachedArticle,
          sourceUrl: detectedSource.url.toString(),
          importStatus: 'cache'
        };
      }

      throw error;
    }
  }
}

export const importWhitelistedNewsArticle = async (
  articleUrl: string,
  options: NewsImportServiceOptions = {}
): Promise<ImportedArticle> => {
  const importer = new WhitelistNewsSourceImporter(options);
  return importer.import(articleUrl);
};
