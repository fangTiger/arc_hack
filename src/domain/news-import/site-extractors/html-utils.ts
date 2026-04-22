const NOISE_PATTERNS = [
  /相关阅读/u,
  /下载\s*App/iu,
  /^分享到/u,
  /^分享至/u,
  /^免责声明/u,
  /^声明[:：]/u,
  /^打开微信/u,
  /^扫码/u
];

const TITLE_SUFFIX_PATTERNS = [
  /\s*[-|_]\s*PANews$/iu,
  /\s*[-|_]\s*ChainCatcher$/iu,
  /\s*[-|_]\s*wublock123$/iu
];

const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>'
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findFirstCapture = (source: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const captured = match?.[1];

    if (captured) {
      return captured;
    }
  }

  return undefined;
};

export const extractMetaContent = (
  html: string,
  candidates: Array<{ attribute: 'property' | 'name'; value: string }>
): string | undefined => {
  const patterns = candidates.flatMap(({ attribute, value }) => {
    const escapedValue = escapeRegExp(value);

    return [
      new RegExp(
        `<meta\\b[^>]*${attribute}=["']${escapedValue}["'][^>]*content=["']([\\s\\S]*?)["'][^>]*>`,
        'iu'
      ),
      new RegExp(
        `<meta\\b[^>]*content=["']([\\s\\S]*?)["'][^>]*${attribute}=["']${escapedValue}["'][^>]*>`,
        'iu'
      )
    ];
  });

  return findFirstCapture(html, patterns);
};

export const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/giu, (entity) => HTML_ENTITY_MAP[entity] ?? entity)
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

export const stripHtmlTags = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');

export const normalizeInlineText = (value: string | undefined): string =>
  decodeHtmlEntities(stripHtmlTags(value ?? ''))
    .replace(/\s+/gu, ' ')
    .trim();

export const normalizeParagraphs = (paragraphs: string[]): string[] =>
  paragraphs
    .map((paragraph) => normalizeInlineText(paragraph))
    .filter(Boolean)
    .filter((paragraph) => NOISE_PATTERNS.every((pattern) => !pattern.test(paragraph)));

export const extractParagraphs = (html: string): string[] =>
  normalizeParagraphs(Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu), (match) => match[1]));

export const normalizeTitle = (value: string | undefined): string => {
  const normalized = normalizeInlineText(value);

  return TITLE_SUFFIX_PATTERNS.reduce((current, pattern) => current.replace(pattern, '').trim(), normalized);
};

export const normalizeExcerpt = (value: string | undefined): string | undefined => {
  const normalized = normalizeInlineText(value);
  return normalized || undefined;
};

export const buildArticleText = (paragraphs: string[], maxTextLength: number): string => {
  const text = normalizeParagraphs(paragraphs).join('\n\n').trim();

  if (text.length <= maxTextLength) {
    return text;
  }

  return text.slice(0, maxTextLength).trimEnd();
};
