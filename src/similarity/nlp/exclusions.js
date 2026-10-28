const BIBLIOGRAPHY_PATTERNS = [
  /^(?:\d+[\.\)]\s*)?(?:references|bibliography|works cited|literature cited|sources cited|references and notes)\s*$/im,
  /^(?:\d+[\.\)]\s*)?references\s*[:\n]/im,
];

export function detectQuotes(text) {
  const ranges = [];

  const doubleQuoteRegex = /["“]([^"”\n\r]{10,}?)["”]/g;
  let match;
  while ((match = doubleQuoteRegex.exec(text)) !== null) {
    const full = match[0];
    const inner = match[1] ?? "";
    const wordCount = (inner.match(/\S+/g) ?? []).length;
    if (wordCount >= 3) {
      ranges.push({
        type: "quote",
        start: match.index,
        end: match.index + full.length,
        text: full,
      });
    }
  }

  const blockQuoteRegex = /(?:^[ \t]*>[ \t]*.+(?:\r?\n|$))+/gm;
  while ((match = blockQuoteRegex.exec(text)) !== null) {
    const full = match[0];
    const wordCount = (full.match(/\S+/g) ?? []).length;
    if (wordCount >= 3) {
      ranges.push({
        type: "quote",
        start: match.index,
        end: match.index + full.length,
        text: full,
      });
    }
  }

  return ranges;
}

export function detectBibliography(text) {
  const ranges = [];
  const lines = text.split("\n");
  let currentOffset = 0;
  let bibStartOffset = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (bibStartOffset === -1) {
      for (const pattern of BIBLIOGRAPHY_PATTERNS) {
        if (pattern.test(trimmed)) {
          if (currentOffset > text.length * 0.25 || i > 10) {
            bibStartOffset = currentOffset;
            break;
          }
        }
      }
    }

    currentOffset += line.length + 1;
  }

  if (bibStartOffset !== -1) {
    ranges.push({
      type: "bibliography",
      start: bibStartOffset,
      end: text.length,
      text: text.substring(bibStartOffset),
    });
  }

  return ranges;
}

export function isRangeExcluded(start, end, exclusions) {
  for (const range of exclusions) {
    const overlapStart = Math.max(start, range.start);
    const overlapEnd = Math.min(end, range.end);
    if (overlapEnd > overlapStart) {
      const overlapLength = overlapEnd - overlapStart;
      const rangeLength = end - start;
      if (rangeLength > 0 && overlapLength / rangeLength > 0.5) {
        return true;
      }
    }
  }
  return false;
}
