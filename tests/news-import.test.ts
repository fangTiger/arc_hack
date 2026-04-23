import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const loadFixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/news-import/${name}`, import.meta.url), 'utf8');

const loadNewsImportModule = async () => import('../src/domain/news-import/index.js');

const createHtmlResponse = (options: {
  body: string;
  status?: number;
  url: string;
  headers?: Record<string, string>;
}): Response =>
  ({
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    url: options.url,
    headers: new Headers(options.headers),
    body: new Response(options.body).body,
    text: async () => options.body
  }) as unknown as Response;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('whitelist news import domain', () => {
  it('should import a wublock123 article fixture into the unified structure', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://wublock123.com/p/654321',
        body: loadFixture('wublock123.html'),
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://wublock123.com/p/654321', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).resolves.toMatchObject({
      sourceUrl: 'https://wublock123.com/p/654321',
      canonicalUrl: 'https://wublock123.com/p/654321',
      sourceSite: 'wublock123',
      sourceType: 'news',
      title: '吴说获悉：香港虚拟资产 ETF 本周净流入创新高',
      excerpt: '香港比特币与以太坊现货 ETF 本周净流入创阶段新高。',
      text: [
        '香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点，资金继续回流亚洲市场。',
        '多家发行机构表示，机构配置需求与市场风险偏好改善共同推动了本轮申购增长。'
      ].join('\n\n'),
      importStatus: 'live'
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('should import a PANews article fixture and normalize the www host', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://www.panewslab.com/articles/0123456789',
        body: loadFixture('panews.html'),
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://www.panewslab.com/articles/0123456789', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).resolves.toMatchObject({
      sourceUrl: 'https://www.panewslab.com/articles/0123456789',
      canonicalUrl: 'https://panewslab.com/articles/0123456789',
      sourceSite: 'panews',
      sourceType: 'news',
      title: 'PANews：某协议完成 5000 万美元融资',
      excerpt: 'PANews 报道，某协议完成新一轮融资并计划扩展亚洲市场。',
      text: [
        'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资，由多家加密基金参投。',
        '团队表示，新资金将用于扩展亚洲市场、完善链上清算与合规能力。'
      ].join('\n\n'),
      importStatus: 'live'
    });
  });

  it('should import a ChainCatcher article fixture into the unified structure', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://www.chaincatcher.com/article/1234567.html',
        body: loadFixture('chaincatcher.html'),
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://www.chaincatcher.com/article/1234567.html', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).resolves.toMatchObject({
      sourceUrl: 'https://www.chaincatcher.com/article/1234567.html',
      canonicalUrl: 'https://chaincatcher.com/article/1234567.html',
      sourceSite: 'chaincatcher',
      sourceType: 'news',
      title: 'ChainCatcher：模块化基础设施项目加速亚洲扩张',
      excerpt: 'ChainCatcher 报道，某模块化基础设施项目宣布扩展亚洲支付与数据服务布局。',
      text: [
        'ChainCatcher 4 月 22 日消息，某模块化基础设施项目宣布将其支付与数据服务节点扩展至新加坡、香港与首尔。',
        '项目团队表示，新部署将优先服务稳定币结算、数据可用性和开发者工具三类核心场景。'
      ].join('\n\n'),
      importStatus: 'live'
    });
  });

  it('should cache successful imports and reuse request and canonical URLs on cache fallback', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-news-import-cache-'));
    temporaryDirectories.push(workingDirectory);
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const cacheRootDirectory = join(workingDirectory, 'artifacts', 'news-import-cache');
    const liveFetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://panewslab.com/articles/0123456789/',
        body: loadFixture('panews.html'),
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );
    const fallbackFetchImplementation = vi.fn(async () => {
      throw new Error('network down');
    });

    const liveArticle = await importWhitelistedNewsArticle('https://www.panewslab.com/articles/0123456789?foo=bar', {
      fetchImplementation: liveFetchImplementation as typeof fetch,
      cacheRootDirectory
    });
    const cachedFromRequest = await importWhitelistedNewsArticle('https://www.panewslab.com/articles/0123456789?foo=bar', {
      fetchImplementation: fallbackFetchImplementation as typeof fetch,
      cacheRootDirectory
    });
    const cachedFromCanonical = await importWhitelistedNewsArticle('https://panewslab.com/articles/0123456789/', {
      fetchImplementation: fallbackFetchImplementation as typeof fetch,
      cacheRootDirectory
    });

    expect(liveArticle.sourceUrl).toBe('https://www.panewslab.com/articles/0123456789?foo=bar');
    expect(liveArticle.canonicalUrl).toBe('https://panewslab.com/articles/0123456789');
    expect(liveArticle.importStatus).toBe('live');
    expect(liveArticle.cachedAt).toBeUndefined();
    expect(cachedFromRequest.sourceUrl).toBe('https://www.panewslab.com/articles/0123456789?foo=bar');
    expect(cachedFromRequest.canonicalUrl).toBe('https://panewslab.com/articles/0123456789');
    expect(cachedFromRequest.importStatus).toBe('cache');
    expect(cachedFromRequest.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cachedFromCanonical.sourceUrl).toBe('https://panewslab.com/articles/0123456789/');
    expect(cachedFromCanonical.canonicalUrl).toBe('https://panewslab.com/articles/0123456789');
    expect(cachedFromCanonical.importStatus).toBe('cache');
    expect(cachedFromCanonical.cachedAt).toBe(cachedFromRequest.cachedAt);
    expect(liveFetchImplementation).toHaveBeenCalledTimes(1);
    expect(fallbackFetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('should surface a cache miss when live fetching fails without any stored article', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-news-import-cache-miss-'));
    temporaryDirectories.push(workingDirectory);
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const cacheRootDirectory = join(workingDirectory, 'artifacts', 'news-import-cache');
    const fetchImplementation = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      importWhitelistedNewsArticle('https://wublock123.com/p/999999', {
        fetchImplementation: fetchImplementation as typeof fetch,
        cacheRootDirectory
      })
    ).rejects.toThrow('抓取新闻页面失败');
  });

  it('should surface a clear anti-bot error when wublock123 returns a challenge page', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-news-import-antibot-'));
    temporaryDirectories.push(workingDirectory);
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://www.wublock123.com/articles/kelpdao-exploit-debt-crisis-defi-bad-debt-resolution-58888',
        body: `<html><script>var arg1='3790A4E303DADC5EF6EC6FF87487ED35AF92CA99';document.cookie='challenge=1';location.href='/';</script></html>`,
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://www.wublock123.com/articles/kelpdao-exploit-debt-crisis-defi-bad-debt-resolution-58888', {
        fetchImplementation: fetchImplementation as typeof fetch,
        cacheRootDirectory: join(workingDirectory, 'artifacts', 'news-import-cache')
      })
    ).rejects.toThrow('wublock123 返回了反爬挑战页');
  });

  it('should reject unsupported hosts with a clear error before fetching', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn();

    await expect(
      importWhitelistedNewsArticle('https://example.com/not-supported', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).rejects.toThrow('暂不支持该来源链接');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('should reject redirects that end on a non-whitelist host', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://example.com/landing-page',
        body: loadFixture('panews.html'),
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://www.panewslab.com/articles/redirect-me', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).rejects.toThrow('重定向到了暂不支持的来源');
  });

  it('should reject response bodies that exceed the 1000000 byte limit', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const oversizedHtml = `<html><body>${'a'.repeat(1_000_001)}</body></html>`;
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://wublock123.com/p/oversized',
        body: oversizedHtml,
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    await expect(
      importWhitelistedNewsArticle('https://wublock123.com/p/oversized', {
        fetchImplementation: fetchImplementation as typeof fetch
      })
    ).rejects.toThrow('页面内容超过 1000000 bytes 限制');
  });

  it('should surface a clear timeout error when the response stream aborts after the timeout', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const timeoutSignal = init?.signal;

      return {
        ok: true,
        status: 200,
        url: 'https://wublock123.com/p/timeout-stream',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8'
        }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            timeoutSignal?.addEventListener(
              'abort',
              () => {
                controller.error(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true }
            );
          }
        }),
        text: async () => loadFixture('wublock123.html')
      } as unknown as Response;
    });

    await expect(
      importWhitelistedNewsArticle('https://wublock123.com/p/timeout-stream', {
        fetchImplementation: fetchImplementation as typeof fetch,
        timeoutMs: 5
      })
    ).rejects.toThrow('抓取新闻页面超时');
  });

  it('should truncate extracted article text to 3000 characters and drop tail noise', async () => {
    const { importWhitelistedNewsArticle } = await loadNewsImportModule();
    const longParagraph = 'ChainCatcher 报道，某基础设施项目正在扩展亚洲支付网络并准备上线稳定币结算能力。'.repeat(80);
    const fetchImplementation = vi.fn(async () =>
      createHtmlResponse({
        url: 'https://www.chaincatcher.com/article/9999999.html',
        body: `
          <html>
            <head>
              <title>ChainCatcher：基础设施项目扩大亚洲支付布局</title>
            </head>
            <body>
              <article class="article-detail">
                <h1 class="article-title">ChainCatcher：基础设施项目扩大亚洲支付布局</h1>
                <div class="article-content">
                  <p>${longParagraph}</p>
                  <p>分享到微信</p>
                </div>
              </article>
            </body>
          </html>
        `,
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    );

    const article = await importWhitelistedNewsArticle('https://www.chaincatcher.com/article/9999999.html', {
      fetchImplementation: fetchImplementation as typeof fetch
    });

    expect(article.sourceSite).toBe('chaincatcher');
    expect(article.text.length).toBe(3000);
    expect(article.text.startsWith('ChainCatcher 报道')).toBe(true);
    expect(article.text).not.toContain('分享到微信');
  });
});
