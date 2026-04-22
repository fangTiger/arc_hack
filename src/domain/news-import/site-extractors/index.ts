import type { ImportedArticle, SiteExtractorInput, SupportedNewsSite } from '../types.js';
import { extractChaincatcherArticle } from './chaincatcher-extractor.js';
import { extractPanewsArticle } from './panews-extractor.js';
import { extractWublock123Article } from './wublock123-extractor.js';

const SITE_EXTRACTORS: Record<SupportedNewsSite, (input: SiteExtractorInput) => ImportedArticle> = {
  wublock123: extractWublock123Article,
  panews: extractPanewsArticle,
  chaincatcher: extractChaincatcherArticle
};

export const extractImportedArticle = (input: SiteExtractorInput): ImportedArticle => SITE_EXTRACTORS[input.sourceSite](input);
