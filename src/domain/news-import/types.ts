export const SUPPORTED_NEWS_SITES = ['wublock123', 'panews', 'chaincatcher'] as const;

export type SupportedNewsSite = (typeof SUPPORTED_NEWS_SITES)[number];

export type ImportedArticle = {
  sourceUrl: string;
  canonicalUrl?: string;
  sourceSite: SupportedNewsSite;
  sourceType: 'news';
  title: string;
  text: string;
  excerpt?: string;
  importStatus?: 'live' | 'cache';
  cachedAt?: string;
};

export type DetectedNewsSource = {
  sourceSite: SupportedNewsSite;
  normalizedHost: string;
  url: URL;
};

export type ArticleFetchResult = {
  html: string;
  finalUrl: URL;
  sourceSite: SupportedNewsSite;
};

export type NewsImportServiceOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTextLength?: number;
  cacheRootDirectory?: string;
};

export type SiteExtractorInput = {
  html: string;
  sourceUrl: string;
  sourceSite: SupportedNewsSite;
  maxTextLength: number;
};

export type SiteExtractor = (input: SiteExtractorInput) => ImportedArticle;
