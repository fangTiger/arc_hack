import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { normalizeNewsHost } from '../domain/news-import/source-detector.js';
import type { ImportedArticle, SupportedNewsSite } from '../domain/news-import/types.js';

type NewsImportCacheRecord = Required<
  Pick<ImportedArticle, 'sourceUrl' | 'canonicalUrl' | 'sourceSite' | 'sourceType' | 'title' | 'text' | 'cachedAt'>
> &
  Pick<ImportedArticle, 'excerpt'>;

type NewsImportCacheAliasRecord = {
  kind: 'alias';
  targetKey: string;
};

type NewsImportCacheStoredRecord = {
  kind: 'record';
  record: NewsImportCacheRecord;
};

type NewsImportCacheEntry = NewsImportCacheAliasRecord | NewsImportCacheStoredRecord;

const TRACKING_QUERY_PREFIXES = ['utm_'];
const TRACKING_QUERY_KEYS = new Set(['spm', 'ref', 'fbclid', 'gclid']);
const DEFAULT_HTTP_PORTS = new Set(['80', '443']);

const readJsonFile = async <T>(path: string): Promise<T | null> => {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;

    if (systemError.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex')}.tmp`;

  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryPath, path);
};

const buildStorageKey = (normalizedUrl: string): string => createHash('sha256').update(normalizedUrl).digest('hex');

const isHttpUrl = (value: URL): boolean => value.protocol === 'http:' || value.protocol === 'https:';

const isTrackingQueryKey = (key: string): boolean => {
  const lowerKey = key.toLowerCase();
  return TRACKING_QUERY_KEYS.has(lowerKey) || TRACKING_QUERY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
};

export const normalizeNewsImportUrl = (input: string | URL): string => {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);

  if (!isHttpUrl(url)) {
    throw new Error('新闻导入失败：articleUrl 必须是合法的 http/https 链接。');
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = normalizeNewsHost(url.hostname);

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  url.hash = '';

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  }

  const queryEntries = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingQueryKey(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);

      if (keyComparison !== 0) {
        return keyComparison;
      }

      return leftValue.localeCompare(rightValue);
    });

  url.search = '';

  if (queryEntries.length > 0) {
    const searchParams = new URLSearchParams();

    for (const [key, value] of queryEntries) {
      searchParams.append(key, value);
    }

    url.search = searchParams.toString();
  }

  return url.toString();
};

const buildNewsImportCacheKey = (normalizedUrl: string): string => buildStorageKey(normalizedUrl);

export class FileNewsImportCacheStore {
  constructor(private readonly rootDirectory: string) {}

  getRootDirectory(): string {
    return this.rootDirectory;
  }

  private getEntryPath(key: string): string {
    return join(this.rootDirectory, `${key}.json`);
  }

  private async readEntryByKey(key: string, visitedKeys: Set<string> = new Set()): Promise<NewsImportCacheRecord | null> {
    if (visitedKeys.has(key)) {
      return null;
    }

    visitedKeys.add(key);

    const entry = await readJsonFile<NewsImportCacheEntry>(this.getEntryPath(key));

    if (!entry) {
      return null;
    }

    if ('kind' in entry && entry.kind === 'alias') {
      return this.readEntryByKey(entry.targetKey, visitedKeys);
    }

    return entry.record;
  }

  async read(articleUrl: string | URL): Promise<NewsImportCacheRecord | null> {
    const normalizedUrl = normalizeNewsImportUrl(articleUrl);
    const key = buildNewsImportCacheKey(normalizedUrl);

    return this.readEntryByKey(key);
  }

  async write(record: NewsImportCacheRecord): Promise<void> {
    const normalizedSourceUrl = normalizeNewsImportUrl(record.sourceUrl);
    const normalizedCanonicalUrl = normalizeNewsImportUrl(record.canonicalUrl);
    const sourceKey = buildNewsImportCacheKey(normalizedSourceUrl);
    const canonicalKey = buildNewsImportCacheKey(normalizedCanonicalUrl);

    await writeJsonFile(this.getEntryPath(canonicalKey), {
      kind: 'record',
      record
    } satisfies NewsImportCacheEntry);

    if (sourceKey !== canonicalKey) {
      await writeJsonFile(this.getEntryPath(sourceKey), {
        kind: 'alias',
        targetKey: canonicalKey
      } satisfies NewsImportCacheEntry);
    }
  }
}

export type { NewsImportCacheRecord, SupportedNewsSite };
