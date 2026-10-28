export function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createShingles(tokens, shingleSize = 5) {
  if (tokens.length < shingleSize) {
    if (tokens.length === 0) return [];
    const text = tokens.map((t) => t.normalized).join(" ");
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return [
      {
        hash: fnv1aHash(text),
        text,
        tokenStartIndex: 0,
        tokenEndIndex: tokens.length - 1,
        charStart: first.start,
        charEnd: last.end,
      },
    ];
  }

  const shingles = [];
  for (let i = 0; i <= tokens.length - shingleSize; i++) {
    const slice = tokens.slice(i, i + shingleSize);
    const text = slice.map((t) => t.normalized).join(" ");
    const first = slice[0];
    const last = slice[slice.length - 1];
    shingles.push({
      hash: fnv1aHash(text),
      text,
      tokenStartIndex: i,
      tokenEndIndex: i + shingleSize - 1,
      charStart: first.start,
      charEnd: last.end,
    });
  }

  return shingles;
}

export function extractUniqueHashes(shingles) {
  const set = new Set();
  for (const s of shingles) {
    set.add(s.hash);
  }
  return set;
}

