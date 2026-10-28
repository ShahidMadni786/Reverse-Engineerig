import { tokenizeWithOffsets } from "./normalizer.js";

const COMMON_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "fig", "al", "eg", "ie", "vol", "no", "pp",
]);

export function segmentDocument(text) {
  const tokens = tokenizeWithOffsets(text);
  const paragraphs = segmentParagraphs(text);
  const sentences = segmentSentences(text);

  return {
    paragraphs,
    sentences,
    tokens,
  };
}

export function segmentParagraphs(text) {
  const segments = [];
  const lines = text.split(/(\r?\n\s*\r?\n)/);
  let currentOffset = 0;
  let id = 0;

  for (const part of lines) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && !/^\s+$/.test(part)) {
      const startInPart = part.indexOf(trimmed);
      const start = currentOffset + startInPart;
      const end = start + trimmed.length;
      const wordCount = (trimmed.match(/\S+/g) ?? []).length;
      segments.push({
        id: id++,
        text: trimmed,
        start,
        end,
        wordCount,
      });
    }
    currentOffset += part.length;
  }

  return segments;
}

export function segmentSentences(text) {
  const sentences = [];
  const sentenceRegex = /[^.!?\n]+[.!?]+(?:\s+|\n|$)|[^.!?\n]+$/g;
  let match;
  let id = 0;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    const startInRaw = raw.indexOf(trimmed);
    const start = match.index + startInRaw;
    const end = start + trimmed.length;
    const wordCount = (trimmed.match(/\S+/g) ?? []).length;

    sentences.push({
      id: id++,
      text: trimmed,
      start,
      end,
      wordCount,
    });
  }

  return sentences;
}
