import { detectWhitelistedNewsSource } from './source-detector.js';
import type { ArticleFetchResult, NewsImportServiceOptions } from './types.js';

export const NEWS_IMPORT_TIMEOUT_MS = 8_000;
export const NEWS_IMPORT_MAX_RESPONSE_BYTES = 1_000_000;
export const NEWS_IMPORT_MAX_TEXT_LENGTH = 3_000;

type ArticleFetcherOptions = Pick<NewsImportServiceOptions, 'fetchImplementation' | 'timeoutMs' | 'maxResponseBytes'>;

const readResponseTextWithinLimit = async (response: Response, maxResponseBytes: number): Promise<string> => {
  if (!response.body) {
    const html = await response.text();

    if (Buffer.byteLength(html) > maxResponseBytes) {
      throw new Error(`新闻导入失败：页面内容超过 ${maxResponseBytes} bytes 限制。`);
    }

    return html;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let html = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`新闻导入失败：页面内容超过 ${maxResponseBytes} bytes 限制。`);
    }

    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();

  return html;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

export class ArticleFetcher {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: ArticleFetcherOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? NEWS_IMPORT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? NEWS_IMPORT_MAX_RESPONSE_BYTES;
  }

  async fetch(url: URL): Promise<ArticleFetchResult> {
    let response: Response;

    try {
      response = await this.fetchImplementation(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('新闻导入失败：抓取新闻页面超时。', { cause: error });
      }

      throw new Error('新闻导入失败：抓取新闻页面失败。', { cause: error });
    }

    if (!response.ok) {
      throw new Error(`新闻导入失败：源站返回状态码 ${response.status}。`);
    }

    const finalUrl = new URL(response.url || url.toString());

    try {
      const { sourceSite } = detectWhitelistedNewsSource(finalUrl);
      const html = await readResponseTextWithinLimit(response, this.maxResponseBytes);

      return {
        html,
        finalUrl,
        sourceSite
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('新闻导入失败：抓取新闻页面超时。', { cause: error });
      }

      if (error instanceof Error && error.message.includes('暂不支持该来源链接')) {
        throw new Error('新闻导入失败：链接重定向到了暂不支持的来源。', {
          cause: error
        });
      }

      throw error;
    }
  }
}
