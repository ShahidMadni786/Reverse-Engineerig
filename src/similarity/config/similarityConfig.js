import { resolve } from "node:path";

const rootDir = process.cwd();
const dataDir = process.env["SIMILARITY_DATA_DIR"]
  ? resolve(process.env["SIMILARITY_DATA_DIR"])
  : resolve(rootDir, "data");

export const similarityConfig = {
  port: Number(process.env["SIMILARITY_PORT"] ?? "3000"),
  host: process.env["SIMILARITY_HOST"] ?? "127.0.0.1",
  dataDir,
  dbPath: process.env["SIMILARITY_DB_PATH"] ?? resolve(dataDir, "similarity.db"),
  uploadsDir: resolve(dataDir, "uploads"),
  corpusDir: resolve(dataDir, "corpus"),
  exportsDir: resolve(dataDir, "exports"),
  sessionSecret: process.env["SIMILARITY_SECRET"] ?? "local-similarity-academic-key-2026",
  defaultShingleSize: 5,
  minExactMatchWords: 6,
  smallMatchWordThreshold: 8,
  defaultSimilarityThreshold: 0.10,
  defaultExcludeQuotes: false,
  defaultExcludeBibliography: true,
  defaultExcludeSmallMatches: true,
};
