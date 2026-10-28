#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { similarityConfig } from "./config/similarityConfig.js";
import { SimilarityHttpServer } from "./server/httpServer.js";
import { CorpusRepository } from "./db/corpusRepository.js";
import { extractDocument } from "./extractors/documentExtractor.js";
import { SimilarityEngine } from "./engine/similarityEngine.js";
import { UserRepository } from "./db/userRepository.js";
import { exportHtmlReport } from "./reporting/htmlExporter.js";
import { SubmissionRepository } from "./db/submissionRepository.js";
import { ReportRepository } from "./db/reportRepository.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

async function main() {
  UserRepository.ensureDefaultUsers();
  CorpusRepository.ensureIndexVersion();

  switch (command) {
    case "start":
    case "serve": {
      const portIndex = args.indexOf("--port");
      const port = portIndex !== -1 && args[portIndex + 1] ? Number(args[portIndex + 1]) : similarityConfig.port;
      const server = new SimilarityHttpServer();
      const actualPort = await server.start(port);
      console.log(`\n======================================================`);
      console.log(` LOCAL ACADEMIC SIMILARITY PLATFORM`);
      console.log(` Running locally at: http://localhost:${actualPort}`);
      console.log(` Database: ${similarityConfig.dbPath}`);
      console.log(` Offline Mode: Active (No external services required)`);
      console.log(` Sign in with the administrator credentials created at first launch.`);
      console.log(`======================================================\n`);
      break;
    }

    case "ingest": {
      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: cli.mjs ingest <path/to/doc> [--title <title>] [--author <author>]");
        process.exit(1);
      }
      const absPath = resolve(filePath);
      if (!existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        process.exit(1);
      }

      const buffer = readFileSync(absPath);
      const fileName = basename(absPath);
      const titleIndex = args.indexOf("--title");
      const authorIndex = args.indexOf("--author");
      const title = titleIndex !== -1 ? args[titleIndex + 1] : fileName;
      const author = authorIndex !== -1 ? args[authorIndex + 1] : null;

      console.log(`Extracting text from ${fileName}...`);
      const processed = extractDocument(fileName, buffer);

      console.log(`Indexing ${processed.wordCount} words into local corpus...`);
      const doc = CorpusRepository.addDocument(
        title || fileName,
        author,
        "academic",
        fileName,
        absPath,
        processed.fileHash,
        processed.fileType,
        processed.rawText,
        processed.metadata,
      );

      console.log(`Successfully indexed "${doc.title}" (ID: ${doc.id}) into local corpus.`);
      break;
    }

    case "compare": {
      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: cli.mjs compare <path/to/doc> [--exclude-quotes] [--exclude-bib]");
        process.exit(1);
      }
      const absPath = resolve(filePath);
      if (!existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        process.exit(1);
      }

      const buffer = readFileSync(absPath);
      const fileName = basename(absPath);
      const processed = extractDocument(fileName, buffer);

      const excludeQuotes = args.includes("--exclude-quotes");
      const excludeBib = args.includes("--exclude-bib");

      console.log(`\nAnalyzing "${fileName}" against local corpus...`);
      const result = SimilarityEngine.analyze(processed.rawText, {
        excludeQuotes,
        excludeBibliography: excludeBib,
      });

      console.log(`\n--- RESULTS ---`);
      console.log(`Overall Similarity Index: ${result.overallScore}%`);
      console.log(`Total Document Words:     ${result.totalWordsCount}`);
      console.log(`Analyzable Valid Words:   ${result.validWordsCount}`);
      console.log(`Matched Words:            ${result.matchedWordsCount}`);
      console.log(`Matched Sources Count:    ${result.sources.length}`);

      if (result.sources.length > 0) {
        console.log(`\nTop Matched Sources:`);
        result.sources.forEach((s, idx) => {
          console.log(`  ${idx + 1}. [${s.similarityPercent}%] "${s.title}" (${s.matchedWords} words, ${s.matchCount} passages)`);
        });
      }

      console.log(`\nSummary: ${result.summary}\n`);
      break;
    }

    case "stats": {
      const corpus = CorpusRepository.getCorpusStats();
      const subs = SubmissionRepository.getStats();
      const avg = ReportRepository.getAverageScore();

      console.log(`\n--- LOCAL PLATFORM STATISTICS ---`);
      console.log(`Corpus Documents:     ${corpus.totalDocs}`);
      console.log(`Corpus Words Indexed: ${corpus.totalWords.toLocaleString()}`);
      console.log(`Indexed Shingles:     ${corpus.indexedShingles.toLocaleString()}`);
      console.log(`Total Submissions:    ${subs.totalSubmissions}`);
      console.log(`Completed:            ${subs.completedCount}`);
      console.log(`Average Similarity:   ${avg}%\n`);
      break;
    }

    default:
      console.log(`\nLocal Academic Similarity Platform CLI`);
      console.log(`Commands:`);
      console.log(`  start [--port 3000]               Start local web application`);
      console.log(`  ingest <file> [--title] [--author] Add reference document to local corpus`);
      console.log(`  compare <file>                    Run similarity analysis on document`);
      console.log(`  stats                             Show local corpus & submission stats`);
      console.log(`  help                              Show this help menu\n`);
      break;
  }
}

main().catch((err) => {
  console.error("CLI Error:", err);
  process.exit(1);
});
