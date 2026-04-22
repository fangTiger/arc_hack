import type { DetectedNewsSource, SupportedNewsSite } from './types.js';

const SUPPORTED_HOSTS: Record<string, SupportedNewsSite> = {
  'wublock123.com': 'wublock123',
  'panewslab.com': 'panews',
  'chaincatcher.com': 'chaincatcher'
};

export const SUPPORTED_NEWS_SOURCE_LABELS: Record<SupportedNewsSite, string> = {
  wublock123: 'wublock123',
  panews: 'PANews',
  chaincatcher: 'ChainCatcher'
};

const formatSupportedSources = (): string => Object.values(SUPPORTED_NEWS_SOURCE_LABELS).join('、');

export const normalizeNewsHost = (host: string): string => host.trim().toLowerCase().replace(/^www\./, '');

export const detectWhitelistedNewsSource = (articleUrl: string | URL): DetectedNewsSource => {
  let parsedUrl: URL;

  try {
    parsedUrl = articleUrl instanceof URL ? articleUrl : new URL(articleUrl);
  } catch (error) {
    throw new Error('新闻导入失败：articleUrl 必须是合法的 http/https 链接。', {
      cause: error
    });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('新闻导入失败：articleUrl 必须是合法的 http/https 链接。');
  }

  const normalizedHost = normalizeNewsHost(parsedUrl.hostname);
  const sourceSite = SUPPORTED_HOSTS[normalizedHost];

  if (!sourceSite) {
    throw new Error(`新闻导入失败：暂不支持该来源链接，仅支持 ${formatSupportedSources()}。`);
  }

  return {
    sourceSite,
    normalizedHost,
    url: parsedUrl
  };
};
