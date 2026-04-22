import {
  ArticleFetcher,
  NEWS_IMPORT_MAX_TEXT_LENGTH
} from './article-fetcher.js';
import { detectWhitelistedNewsSource } from './source-detector.js';
import { extractImportedArticle } from './site-extractors/index.js';
import type { ImportedArticle, NewsImportServiceOptions } from './types.js';

export class WhitelistNewsSourceImporter {
  private readonly articleFetcher: ArticleFetcher;
  private readonly maxTextLength: number;

  constructor(options: NewsImportServiceOptions = {}) {
    this.articleFetcher = new ArticleFetcher(options);
    this.maxTextLength = options.maxTextLength ?? NEWS_IMPORT_MAX_TEXT_LENGTH;
  }

  async import(articleUrl: string): Promise<ImportedArticle> {
    const detectedSource = detectWhitelistedNewsSource(articleUrl);
    const fetchedArticle = await this.articleFetcher.fetch(detectedSource.url);

    return extractImportedArticle({
      sourceUrl: detectedSource.url.toString(),
      sourceSite: fetchedArticle.sourceSite,
      html: fetchedArticle.html,
      maxTextLength: this.maxTextLength
    });
  }
}

export const importWhitelistedNewsArticle = async (
  articleUrl: string,
  options: NewsImportServiceOptions = {}
): Promise<ImportedArticle> => {
  const importer = new WhitelistNewsSourceImporter(options);
  return importer.import(articleUrl);
};
