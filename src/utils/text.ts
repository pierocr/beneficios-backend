export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

export const toLowerNormalized = (value: string): string =>
  normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const truncateText = (value: string, maxLength = 140): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
};

export const htmlToText = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
