import assert from "node:assert/strict";
import { resolve } from "node:path";

// Ensure test database is isolated
const testDir = resolve(process.cwd(), "data/test_env");
process.env["SIMILARITY_DATA_DIR"] = testDir;
process.env["SIMILARITY_DB_PATH"] = resolve(testDir, "test_similarity.db");

import { extractTxt, CorruptDocumentError, UnsupportedDocumentError } from "../extractors/txtExtractor.js";
import { extractDocument } from "../extractors/documentExtractor.js";
import { normalizeText, tokenizeWithOffsets } from "../nlp/normalizer.js";
import { segmentParagraphs, segmentSentences } from "../nlp/segmenter.js";
import { detectQuotes, detectBibliography } from "../nlp/exclusions.js";
import { createShingles, fnv1aHash } from "../engine/shingling.js";
import { computeJaccardSimilarity } from "../engine/jaccardMatcher.js";
import { TfidfMatcher } from "../engine/tfidfMatcher.js";
import { getDatabase, closeDatabase } from "../db/database.js";
import { UserRepository } from "../db/userRepository.js";
import { CorpusRepository } from "../db/corpusRepository.js";
import { SubmissionRepository } from "../db/submissionRepository.js";
import { ReportRepository } from "../db/reportRepository.js";
import { SimilarityEngine } from "../engine/similarityEngine.js";
import { exportHtmlReport } from "../reporting/htmlExporter.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";

async function runTests() {
  console.log("\n========================================================");
  console.log(" RUNNING ACADEMIC SIMILARITY PLATFORM TEST SUITE");
  console.log("========================================================\n");

  // Clean test tables to ensure complete isolation
  const db = getDatabase();
  db.exec(`
    DELETE FROM reports;
    DELETE FROM submissions;
    DELETE FROM corpus_index;
    DELETE FROM corpus_documents;
    DELETE FROM sessions;
    DELETE FROM users;
  `);

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // 1. Text Normalization & Tokenization
  test("NLP: Text normalization removes non-alphanumeric and case folds", () => {
    const raw = "Artificial Intelligence: A Modern Approach! (3rd Ed.)";
    const norm = normalizeText(raw);
    assert.equal(norm, "artificial intelligence a modern approach 3rd ed");
  });

  test("NLP: Tokenize with precise character offsets", () => {
    const raw = "The algorithm calculates cosine similarity.";
    const tokens = tokenizeWithOffsets(raw);
    assert.equal(tokens.length, 5);
    assert.equal(tokens[0]?.normalized, "the");
    assert.equal(tokens[0]?.start, 0);
    assert.equal(tokens[0]?.end, 3);
    assert.equal(tokens[4]?.normalized, "similarity");
  });

  // 2. Segmentation
  test("NLP: Segment paragraphs and sentences", () => {
    const text = "First paragraph here. It has two sentences.\n\nSecond paragraph here. Another sentence.";
    const paras = segmentParagraphs(text);
    const sentences = segmentSentences(text);
    assert.equal(paras.length, 2);
    assert.equal(sentences.length, 4);
    assert.equal(paras[0]?.wordCount, 7);
  });

  // 3. Exclusions
  test("NLP: Detect quoted passages", () => {
    const sample = 'The author stated, "this exact methodology was developed specifically for neural networks" in 2024.';
    const quotes = detectQuotes(sample);
    assert.equal(quotes.length, 1);
    assert.ok(quotes[0]?.text.includes("this exact methodology"));
  });

  test("NLP: Detect bibliography / reference section", () => {
    const sample = `Introduction to the paper.\nBody section discussing findings.\n\nReferences\n1. Smith, J. (2020). Modern NLP.\n2. Doe, A. (2022). Deep Learning.`;
    const bib = detectBibliography(sample);
    assert.equal(bib.length, 1);
    assert.ok(bib[0]?.text.startsWith("References"));
  });

  // 4. Document Extraction & File Validation
  test("Extraction: Extract valid plain text buffer", () => {
    const buf = Buffer.from("Simple academic research abstract.", "utf8");
    const extracted = extractTxt(buf);
    assert.equal(extracted.text, "Simple academic research abstract.");
  });

  test("Extraction: Handle corrupt document / binary file masquerade", () => {
    const corruptBuf = Buffer.alloc(500, 0);
    assert.throws(() => extractTxt(corruptBuf), CorruptDocumentError);
  });

  test("Extraction: Reject unsupported file format", () => {
    const buf = Buffer.from("test content");
    assert.throws(() => extractDocument("document.xyz", buf), UnsupportedDocumentError);
  });

  // 5. Similarity Engine Core (Shingling, Jaccard, TF-IDF)
  test("Engine: FNV-1a hashing is deterministic", () => {
    const h1 = fnv1aHash("academic integrity and plagiarism detection");
    const h2 = fnv1aHash("academic integrity and plagiarism detection");
    const h3 = fnv1aHash("different phrase altogether");
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  });

  test("Engine: Shingle generation with sliding window", () => {
    const tokens = tokenizeWithOffsets("one two three four five six seven");
    const shingles = createShingles(tokens, 5);
    assert.equal(shingles.length, 3);
    assert.equal(shingles[0]?.text, "one two three four five");
    assert.equal(shingles[2]?.text, "three four five six seven");
  });

  test("Engine: Jaccard similarity and containment on overlapping sets", () => {
    const setA = new Set([1, 2, 3, 4, 5]);
    const setB = new Set([3, 4, 5, 6, 7]);
    const res = computeJaccardSimilarity(setA, setB);
    assert.equal(res.intersectionCount, 3);
    assert.equal(res.unionCount, 7);
    assert.equal(res.jaccardScore, 0.4286);
    assert.equal(res.containmentScore, 0.6);
  });

  test("Engine: TF-IDF vector space cosine similarity", () => {
    const query = tokenizeWithOffsets("quantum computing algorithms superposition entanglement");
    const corpusDoc1 = {
      id: "doc-1",
      tokens: tokenizeWithOffsets("quantum computing algorithms superposition states"),
    };
    const corpusDoc2 = {
      id: "doc-2",
      tokens: tokenizeWithOffsets("photosynthesis cellular plant biology chlorophyll"),
    };

    const results = TfidfMatcher.compare(query, [corpusDoc1, corpusDoc2]);
    assert.equal(results.length, 2);
    const doc1Res = results.find((r) => r.docId === "doc-1");
    const doc2Res = results.find((r) => r.docId === "doc-2");
    assert.ok(doc1Res.cosineSimilarity > 0.6, "Doc 1 should have high cosine similarity");
    assert.equal(doc2Res.cosineSimilarity, 0.0, "Doc 2 with zero overlapping terms should have 0.0 cosine similarity");
  });

  // 6. Database & Persistence Layer
  test("DB: Initialize SQLite database and tables", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes("users"));
    assert.ok(tableNames.includes("corpus_documents"));
    assert.ok(tableNames.includes("corpus_index"));
    assert.ok(tableNames.includes("submissions"));
    assert.ok(tableNames.includes("reports"));
  });

  test("Auth: Password hashing and verification with timing safety", () => {
    const { hash, salt } = hashPassword("secretPassword123");
    assert.ok(hash && salt);
    assert.ok(verifyPassword("secretPassword123", hash, salt));
    assert.ok(!verifyPassword("wrongPassword", hash, salt));
  });

  let testUser;
  test("Auth & RBAC: User creation and session management", () => {
    testUser = UserRepository.createUser("testinstructor", "inst@university.edu", "pass123", "instructor", "Dr. Test");
    assert.equal(testUser.role, "instructor");

    const session = UserRepository.createSession(testUser.id);
    const validated = UserRepository.validateSession(session.token);
    assert.ok(validated);
    assert.equal(validated?.username, "testinstructor");

    UserRepository.revokeSession(session.token);
    assert.equal(UserRepository.validateSession(session.token), null);
  });

  // 7. Incremental Corpus Indexing & Match Detection
  test("Corpus: Ingest reference paper and verify incremental indexing", () => {
    const paperText = `Distributed systems require consensus algorithms to achieve agreement among multiple independent nodes. The Raft consensus algorithm was designed to be easy to understand and implement compared to Paxos. It decomposes consensus into leader election, log replication, and safety. Each node in the cluster can be in one of three states: leader, follower, or candidate.`;

    const doc = CorpusRepository.addDocument(
      "Consensus in Distributed Systems",
      "Diego Ongaro",
      "academic",
      "raft-paper.txt",
      "local://test/raft.txt",
      "hash-101",
      "txt",
      paperText,
    );

    assert.ok(doc.id);
    const stats = CorpusRepository.getCorpusStats();
    assert.ok(stats.totalDocs >= 1);
    assert.ok(stats.indexedShingles > 10);
  });

  // 8. End-to-End Submission Comparison & Report Generation
  test("End-to-End: Submission with known overlap produces accurate report", () => {
    const studentSubmissionText = `Cloud infrastructure heavily relies on reliable consensus protocols.
The Raft consensus algorithm was designed to be easy to understand and implement compared to Paxos. It decomposes consensus into leader election, log replication, and safety.
Furthermore, distributed applications utilize containerization for scalable deployment.`;

    const sub = SubmissionRepository.createSubmission(
      testUser.id,
      "Student Paper on Cloud Consensus",
      "Student Alex",
      "essay.txt",
      "local://test/essay.txt",
      "hash-sub-1",
      "txt",
      studentSubmissionText,
    );

    assert.equal(sub.status, "pending");

    const analysis = SimilarityEngine.analyze(studentSubmissionText, {
      excludeSmallMatches: true,
      smallMatchThreshold: 6,
    });

    assert.ok(analysis.overallScore > 35, `Expected > 35% similarity, got ${analysis.overallScore}%`);
    assert.equal(analysis.sources.length, 1);
    assert.equal(analysis.sources[0]?.title, "Consensus in Distributed Systems");
    assert.ok(analysis.matches.length > 0);

    const report = ReportRepository.saveReport(sub.id, analysis);
    assert.equal(report.submissionId, sub.id);
    assert.equal(report.overallScore, analysis.overallScore);

    const html = exportHtmlReport(sub, report);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Similarity Index"));
    assert.ok(html.includes("Consensus in Distributed Systems"));
    assert.ok(html.includes("mark class=\"similarity-highlight\""));
  });

  // 9. Dynamic Exclusion Filter Test
  test("Exclusion: Exclude bibliography section properly from similarity", () => {
    const textWithBib = `This is an original analysis of artificial neural networks. We propose a recurrent architecture.
References
The Raft consensus algorithm was designed to be easy to understand and implement compared to Paxos. It decomposes consensus into leader election, log replication, and safety.`;

    const withBibResult = SimilarityEngine.analyze(textWithBib, {
      excludeBibliography: false,
    });

    const withoutBibResult = SimilarityEngine.analyze(textWithBib, {
      excludeBibliography: true,
    });

    assert.ok(
      withBibResult.overallScore > withoutBibResult.overallScore,
      "Excluding bibliography should reduce similarity score",
    );
    assert.equal(withoutBibResult.overallScore, 0, "Original portion should have 0% similarity to Raft");
  });

  console.log(`\n--------------------------------------------------------`);
  console.log(` RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`--------------------------------------------------------\n`);

  closeDatabase();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
