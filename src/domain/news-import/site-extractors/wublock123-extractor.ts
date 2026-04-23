import type { ImportedArticle, SiteExtractorInput } from '../types.js';
import {
  buildArticleText,
  extractMetaContent,
  extractParagraphs,
  findFirstCapture,
  normalizeExcerpt,
  normalizeTitle
} from './html-utils.js';

const extractWublock123Body = (html: string): string =>
  findFirstCapture(html, [
    /<div\b[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/article>/iu,
    /<article\b[^>]*>([\s\S]*?)<\/article>/iu
  ]) ?? html;

const extractWublock123Title = (html: string): string =>
  normalizeTitle(
    findFirstCapture(html, [
      /<h1\b[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu,
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu
    ]) ??
      extractMetaContent(html, [{ attribute: 'property', value: 'og:title' }]) ??
      findFirstCapture(html, [/<title\b[^>]*>([\s\S]*?)<\/title>/iu])
  );

const looksLikeWublock123ChallengePage = (html: string): boolean =>
  /<script>\s*var\s+arg1=['"][0-9a-f]{16,}['"]/iu.test(html) ||
  /document\.cookie/iu.test(html) ||
  /location\.href/iu.test(html);

export const extractWublock123Article = (input: SiteExtractorInput): ImportedArticle => {
  if (looksLikeWublock123ChallengePage(input.html)) {
    throw new Error('新闻导入失败：wublock123 返回了反爬挑战页，当前无法实时抓取该链接。');
  }

  const title = extractWublock123Title(input.html);
  const excerpt = normalizeExcerpt(extractMetaContent(input.html, [{ attribute: 'property', value: 'og:description' }]));
  const paragraphs = extractParagraphs(extractWublock123Body(input.html));
  const text = buildArticleText(paragraphs.length > 0 ? paragraphs : extractParagraphs(input.html), input.maxTextLength);

  if (!title || !text) {
    throw new Error('新闻导入失败：无法解析 wublock123 文章正文。');
  }

  return {
    sourceUrl: input.sourceUrl,
    sourceSite: input.sourceSite,
    sourceType: 'news',
    title,
    text,
    ...(excerpt ? { excerpt } : {})
  };
};
