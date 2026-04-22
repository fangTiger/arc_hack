import type { ImportedArticle, SiteExtractorInput } from '../types.js';
import {
  buildArticleText,
  extractMetaContent,
  extractParagraphs,
  findFirstCapture,
  normalizeExcerpt,
  normalizeTitle
} from './html-utils.js';

const extractChainCatcherBody = (html: string): string =>
  findFirstCapture(html, [
    /<div\b[^>]*class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/article>/iu,
    /<article\b[^>]*>([\s\S]*?)<\/article>/iu
  ]) ?? html;

const extractChainCatcherTitle = (html: string): string =>
  normalizeTitle(
    findFirstCapture(html, [
      /<h1\b[^>]*class=["'][^"']*article-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu,
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu
    ]) ??
      extractMetaContent(html, [{ attribute: 'property', value: 'og:title' }]) ??
      findFirstCapture(html, [/<title\b[^>]*>([\s\S]*?)<\/title>/iu])
  );

export const extractChaincatcherArticle = (input: SiteExtractorInput): ImportedArticle => {
  const title = extractChainCatcherTitle(input.html);
  const excerpt = normalizeExcerpt(
    extractMetaContent(input.html, [
      { attribute: 'property', value: 'og:description' },
      { attribute: 'name', value: 'description' }
    ])
  );
  const paragraphs = extractParagraphs(extractChainCatcherBody(input.html));
  const text = buildArticleText(paragraphs.length > 0 ? paragraphs : extractParagraphs(input.html), input.maxTextLength);

  if (!title || !text) {
    throw new Error('新闻导入失败：无法解析 ChainCatcher 文章正文。');
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
