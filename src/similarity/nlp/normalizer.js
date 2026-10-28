export function normalizeText(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeWithOffsets(text) {
  const tokens = [];
  const wordRegex = /[\p{L}\p{M}\p{N}]+/gu;
  let match;
  let index = 0;

  while ((match = wordRegex.exec(text)) !== null) {
    const rawWord = match[0];
    const start = match.index;
    const end = start + rawWord.length;
    tokens.push({
      text: rawWord,
      normalized: rawWord.normalize("NFKC").toLowerCase(),
      start,
      end,
      index: index++,
    });
  }

  return tokens;
}

