import { tokenizeWithOffsets } from "../nlp/normalizer.js";
import { detectQuotes, detectBibliography, isRangeExcluded } from "../nlp/exclusions.js";
import { createShingles } from "./shingling.js";
import { CorpusRepository } from "../db/corpusRepository.js";
import { TfidfMatcher } from "./tfidfMatcher.js";
import { computeJaccardSimilarity } from "./jaccardMatcher.js";
import { similarityConfig } from "../config/similarityConfig.js";

export class SimilarityEngine {
  static analyze(rawText, customSettings) {
    const settings = {
      excludeQuotes: customSettings?.excludeQuotes ?? similarityConfig.defaultExcludeQuotes,
      excludeBibliography: customSettings?.excludeBibliography ?? similarityConfig.defaultExcludeBibliography,
      excludeSmallMatches: customSettings?.excludeSmallMatches ?? similarityConfig.defaultExcludeSmallMatches,
      smallMatchThreshold: customSettings?.smallMatchThreshold ?? similarityConfig.smallMatchWordThreshold,
      similarityThreshold: customSettings?.similarityThreshold ?? similarityConfig.defaultSimilarityThreshold,
    };

    const allTokens = tokenizeWithOffsets(rawText);
    const quotes = detectQuotes(rawText);
    const bibliography = detectBibliography(rawText);

    const activeExclusions = [];
    if (settings.excludeQuotes) {
      activeExclusions.push(...quotes);
    }
    if (settings.excludeBibliography) {
      activeExclusions.push(...bibliography);
    }

    const excludedTokenIndices = new Set();
    let excludedWordsCount = 0;

    for (const token of allTokens) {
      if (isRangeExcluded(token.start, token.end, activeExclusions)) {
        excludedTokenIndices.add(token.index);
        excludedWordsCount++;
      }
    }

    const validWordsCount = allTokens.length - excludedWordsCount;
    if (validWordsCount <= 0 || allTokens.length === 0) {
      return this.emptyResult(allTokens.length, quotes, bibliography, settings);
    }

    const allCorpusDocs = CorpusRepository.listDocuments();
    const shingles = createShingles(allTokens, similarityConfig.defaultShingleSize);

    const validShingles = [];
    for (const shingle of shingles) {
      let isExcluded = false;
      for (let i = shingle.tokenStartIndex; i <= shingle.tokenEndIndex; i++) {
        if (excludedTokenIndices.has(i)) {
          isExcluded = true;
          break;
        }
      }
      if (!isExcluded) {
        validShingles.push(shingle);
      }
    }

    const matchMap = CorpusRepository.findMatchesForShingles(validShingles);

    const corpusDocCache = new Map();
    const getCorpusDoc = (id) => {
      let doc = corpusDocCache.get(id);
      if (!doc) {
        const fetched = CorpusRepository.getDocumentById(id);
        if (fetched) {
          corpusDocCache.set(id, fetched);
          doc = fetched;
        }
      }
      return doc ?? null;
    };

    const matchesByDoc = new Map();
    const corpusTokenCache = new Map();

    for (const shingle of validShingles) {
      const hits = matchMap.get(shingle.hash);
      if (!hits) continue;

      for (const hit of hits) {
        const doc = getCorpusDoc(hit.docId);
        if (!doc) continue;
        let sourceTokens = corpusTokenCache.get(hit.docId);
        if (!sourceTokens) {
          sourceTokens = tokenizeWithOffsets(doc.rawText);
          corpusTokenCache.set(hit.docId, sourceTokens);
        }
        const sourceShingleText = sourceTokens
          .slice(hit.position, hit.position + (shingle.tokenEndIndex - shingle.tokenStartIndex + 1))
          .map((token) => token.normalized)
          .join(" ");
        if (sourceShingleText !== shingle.text) continue;

        let list = matchesByDoc.get(hit.docId);
        if (!list) {
          list = [];
          matchesByDoc.set(hit.docId, list);
        }
        list.push({
          startToken: shingle.tokenStartIndex,
          endToken: shingle.tokenEndIndex,
        });
      }
    }

    const candidatePassages = [];

    for (const [docId, intervals] of matchesByDoc.entries()) {
      intervals.sort((a, b) => a.startToken - b.startToken);
      const merged = [];

      for (const interval of intervals) {
        if (merged.length === 0) {
          merged.push({ ...interval });
        } else {
          const last = merged[merged.length - 1];
          if (interval.startToken <= last.endToken + 2) {
            last.endToken = Math.max(last.endToken, interval.endToken);
          } else {
            merged.push({ ...interval });
          }
        }
      }

      for (const m of merged) {
        const tokenCount = m.endToken - m.startToken + 1;
        if (!settings.excludeSmallMatches || tokenCount >= settings.smallMatchThreshold) {
          candidatePassages.push({
            docId,
            startToken: m.startToken,
            endToken: m.endToken,
            tokenCount,
          });
        }
      }
    }

    const passageMatches = [];
    let passageIdCounter = 1;

    for (const p of candidatePassages) {
      const firstToken = allTokens[p.startToken];
      const lastToken = allTokens[p.endToken];
      if (!firstToken || !lastToken) continue;

      const charStart = firstToken.start;
      const charEnd = lastToken.end;
      const text = rawText.substring(charStart, charEnd);
      const doc = getCorpusDoc(p.docId);

      passageMatches.push({
        id: `match-${passageIdCounter++}`,
        sourceDocId: p.docId,
        sourceDocTitle: doc ? doc.title : "Unknown Source",
        sourceAuthor: doc ? doc.author : null,
        charStart,
        charEnd,
        text,
        tokenCount: p.tokenCount,
        matchType: "exact",
      });
    }

    const unionedMatchedTokens = new Set();
    const matchedTokensByDoc = new Map();

    for (const p of candidatePassages) {
      let docSet = matchedTokensByDoc.get(p.docId);
      if (!docSet) {
        docSet = new Set();
        matchedTokensByDoc.set(p.docId, docSet);
      }

      for (let i = p.startToken; i <= p.endToken; i++) {
        unionedMatchedTokens.add(i);
        docSet.add(i);
      }
    }

    const matchedWordsCount = unionedMatchedTokens.size;
    const overallScore = validWordsCount > 0 ? Number(((matchedWordsCount / validWordsCount) * 100).toFixed(1)) : 0;

    const corpusTokensList = allCorpusDocs.map((d) => ({
      id: d.id,
      tokens: tokenizeWithOffsets(d.rawText),
    }));

    const tfidfResults = TfidfMatcher.compare(allTokens, corpusTokensList);
    const tfidfMap = new Map();
    for (const res of tfidfResults) {
      tfidfMap.set(res.docId, res.cosineSimilarity);
    }

    const sources = [];
    const queryShingleHashes = new Set(validShingles.map((s) => s.hash));

    for (const [docId, docTokens] of matchedTokensByDoc.entries()) {
      const doc = getCorpusDoc(docId);
      const similarityPercent = validWordsCount > 0 ? Number(((docTokens.size / validWordsCount) * 100).toFixed(1)) : 0;

      const docShingles = createShingles(tokenizeWithOffsets(doc ? doc.rawText : ""), similarityConfig.defaultShingleSize);
      const docHashes = new Set(docShingles.map((s) => s.hash));
      const jaccard = computeJaccardSimilarity(queryShingleHashes, docHashes);

      const cosine = tfidfMap.get(docId) ?? 0;
      const docPassages = passageMatches.filter((pm) => pm.sourceDocId === docId);

      sources.push({
        sourceDocId: docId,
        title: doc ? doc.title : "Document " + docId,
        author: doc ? doc.author : null,
        sourceType: doc ? doc.sourceType : "academic",
        similarityPercent,
        matchedWords: docTokens.size,
        matchCount: docPassages.length,
        jaccardScore: jaccard.jaccardScore,
        cosineSimilarity: cosine,
      });
    }

    sources.sort((a, b) => b.similarityPercent - a.similarityPercent);

    const highestSourceScore = sources.length > 0 ? (sources[0]?.similarityPercent ?? 0) : 0;
    const topJaccard = sources.length > 0 ? Math.max(...sources.map((s) => s.jaccardScore)) : 0;
    const topCosine = sources.length > 0 ? Math.max(...sources.map((s) => s.cosineSimilarity)) : 0;

    const summary = this.generateSummary(
      overallScore,
      sources,
      matchedWordsCount,
      validWordsCount,
      settings,
      allCorpusDocs.length,
    );

    return {
      overallScore,
      highestSourceScore,
      matchedWordsCount,
      totalWordsCount: allTokens.length,
      validWordsCount,
      excludedWordsCount,
      sources,
      matches: passageMatches,
      exclusions: {
        quotes,
        bibliography,
        appliedSettings: settings,
      },
      metrics: {
        topJaccard,
        topCosine,
        corpusDocumentCount: allCorpusDocs.length,
        comparisonAvailable: allCorpusDocs.length > 0,
      },
      summary,
    };
  }

  static emptyResult(totalWords, quotes, bibliography, settings) {
    return {
      overallScore: 0,
      highestSourceScore: 0,
      matchedWordsCount: 0,
      totalWordsCount: totalWords,
      validWordsCount: 0,
      excludedWordsCount: totalWords,
      sources: [],
      matches: [],
      exclusions: {
        quotes,
        bibliography,
        appliedSettings: settings,
      },
      metrics: {
        topJaccard: 0,
        topCosine: 0,
        corpusDocumentCount: CorpusRepository.getCorpusStats().totalDocs,
        comparisonAvailable: CorpusRepository.getCorpusStats().totalDocs > 0,
      },
      summary: "Document contains no analyzable text after applying exclusion filters.",
    };
  }

  static generateSummary(
    overallScore,
    sources,
    matchedWords,
    totalWords,
    settings,
    corpusCount,
  ) {
    const parts = [];

    if (corpusCount === 0) {
      parts.push("No similarity score is available because the local reference corpus is empty. Add authorized reference documents, then run the comparison again.");
    } else if (overallScore === 0) {
      parts.push(
        `No significant similarity matches detected across the ${corpusCount} locally indexed reference documents.`,
      );
    } else {
      parts.push(
        `Identified an overall similarity index of ${overallScore}% (${matchedWords} of ${totalWords} analyzable words matched across ${sources.length} local corpus source${sources.length > 1 ? "s" : ""}).`,
      );
      if (sources[0]) {
        parts.push(
          `Primary overlapping source: "${sources[0].title}" accounting for ${sources[0].similarityPercent}% similarity.`,
        );
      }
    }

    const applied = [];
    if (settings.excludeQuotes) applied.push("Quoted text excluded");
    if (settings.excludeBibliography) applied.push("Bibliography/References excluded");
    if (settings.excludeSmallMatches) applied.push(`Small matches (<${settings.smallMatchThreshold} words) excluded`);
    if (applied.length > 0) {
      parts.push(`Filters applied: ${applied.join(", ")}.`);
    }

    parts.push(
      `Transparency Notice: This evaluation was performed offline using the local document corpus index (${corpusCount} documents). Similarity results are strictly bounded by authorized local holdings and do not reflect external commercial subscriptions.`,
    );

    return parts.join(" ");
  }
}

