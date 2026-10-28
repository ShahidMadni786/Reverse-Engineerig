export class TfidfMatcher {
  static computeTermFrequency(tokens) {
    const tf = new Map();
    for (const t of tokens) {
      const term = t.normalized;
      if (term.length > 1) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
      }
    }
    return tf;
  }

  static compare(queryTokens, corpusDocs) {
    const queryTf = this.computeTermFrequency(queryTokens);
    if (queryTf.size === 0 || corpusDocs.length === 0) {
      return [];
    }

    const df = new Map();
    const allDocTfs = [];

    for (const term of queryTf.keys()) {
      df.set(term, 1);
    }

    for (const doc of corpusDocs) {
      const docTf = this.computeTermFrequency(doc.tokens);
      allDocTfs.push({ id: doc.id, tf: docTf });
      for (const term of docTf.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }

    const totalDocs = corpusDocs.length + 1;

    const getIdf = (term) => {
      const docFreq = df.get(term) ?? 1;
      return Math.log(1 + totalDocs / (1 + docFreq)) + 1;
    };

    const queryWeights = new Map();
    let queryMagnitudeSq = 0;

    for (const [term, freq] of queryTf.entries()) {
      const weight = (1 + Math.log(freq)) * getIdf(term);
      queryWeights.set(term, weight);
      queryMagnitudeSq += weight * weight;
    }

    const queryMagnitude = Math.sqrt(queryMagnitudeSq);
    if (queryMagnitude === 0) return [];

    const results = [];

    for (const doc of allDocTfs) {
      let dotProduct = 0;
      let docMagnitudeSq = 0;
      const sharedTerms = [];

      for (const [term, freq] of doc.tf.entries()) {
        const idf = getIdf(term);
        const weight = (1 + Math.log(freq)) * idf;
        docMagnitudeSq += weight * weight;

        const qWeight = queryWeights.get(term);
        if (qWeight !== undefined) {
          const product = qWeight * weight;
          dotProduct += product;
          sharedTerms.push({ term, score: product });
        }
      }

      const docMagnitude = Math.sqrt(docMagnitudeSq);
      const cosine = docMagnitude > 0 ? dotProduct / (queryMagnitude * docMagnitude) : 0;

      sharedTerms.sort((a, b) => b.score - a.score);

      results.push({
        docId: doc.id,
        cosineSimilarity: Number(cosine.toFixed(4)),
        topSharedTerms: sharedTerms.slice(0, 10),
      });
    }

    return results;
  }
}

