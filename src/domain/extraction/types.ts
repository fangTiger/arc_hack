import type { SupportedNewsSite } from '../news-import/types.js';

export type SourceType = 'news' | 'research';
export type SourceImportMode = 'manual' | 'link' | 'preset';

export type SourceMetadata = {
  articleUrl?: string;
  sourceSite?: SupportedNewsSite;
  importMode?: SourceImportMode;
  importStatus?: 'live' | 'cache';
  cachedAt?: string;
};

export type ExtractionOperation = 'summary' | 'entities' | 'relations';

export type ExtractionRequest = {
  sourceType: SourceType;
  title?: string;
  text: string;
  metadata?: SourceMetadata;
};

export type SummaryExtractionResult = {
  kind: 'summary';
  summary: string;
};

export type ExtractionEntity = {
  name: string;
  type: 'organization' | 'person' | 'topic';
};

export type EntityExtractionResult = {
  kind: 'entities';
  entities: ExtractionEntity[];
};

export type ExtractionRelation = {
  source: string;
  relation: string;
  target: string;
};

export type RelationExtractionResult = {
  kind: 'relations';
  relations: ExtractionRelation[];
};

export type ExtractionResult =
  | SummaryExtractionResult
  | EntityExtractionResult
  | RelationExtractionResult;
