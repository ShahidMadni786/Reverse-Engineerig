export function computeJaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) {
    return {
      jaccardScore: 1.0,
      containmentScore: 1.0,
      intersectionCount: 0,
      unionCount: 0,
      sourceACount: 0,
      sourceBCount: 0,
    };
  }

  if (setA.size === 0 || setB.size === 0) {
    return {
      jaccardScore: 0.0,
      containmentScore: 0.0,
      intersectionCount: 0,
      unionCount: setA.size + setB.size,
      sourceACount: setA.size,
      sourceBCount: setB.size,
    };
  }

  let intersectionCount = 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const item of smaller) {
    if (larger.has(item)) {
      intersectionCount++;
    }
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  const jaccardScore = unionCount > 0 ? intersectionCount / unionCount : 0;
  const containmentScore = setA.size > 0 ? intersectionCount / setA.size : 0;

  return {
    jaccardScore: Number(jaccardScore.toFixed(4)),
    containmentScore: Number(containmentScore.toFixed(4)),
    intersectionCount,
    unionCount,
    sourceACount: setA.size,
    sourceBCount: setB.size,
  };
}
