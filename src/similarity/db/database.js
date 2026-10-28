import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { similarityConfig } from "../config/similarityConfig.js";

let dbInstance = null;

export function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = dirname(similarityConfig.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(similarityConfig.dbPath);

  // Enable WAL mode and foreign keys for high performance and integrity
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  initSchema(db);
  dbInstance = db;
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'instructor', 'student')),
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS corpus_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      source_type TEXT NOT NULL DEFAULT 'academic',
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT UNIQUE NOT NULL,
      file_type TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS corpus_index (
      shingle_hash INTEGER NOT NULL,
      doc_id TEXT NOT NULL REFERENCES corpus_documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (shingle_hash, doc_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_corpus_index_shingle ON corpus_index(shingle_hash);
    CREATE INDEX IF NOT EXISTS idx_corpus_index_doc ON corpus_index(doc_id);

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_type TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      error_message TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      submission_id TEXT UNIQUE NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      overall_score REAL NOT NULL,
      highest_source_score REAL NOT NULL,
      matched_words_count INTEGER NOT NULL,
      total_words_count INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      matches_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      exclusions_used_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_score ON reports(overall_score);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      progress REAL NOT NULL DEFAULT 0.0,
      message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

