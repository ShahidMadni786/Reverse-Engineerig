import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";
import { tokenizeWithOffsets } from "../nlp/normalizer.js";
import { createShingles } from "../engine/shingling.js";
import { similarityConfig } from "../config/similarityConfig.js";

export class CorpusRepository {
  static addDocument(
    title,
    author,
    sourceType,
    fileName,
    filePath,
    fileHash,
    fileType,
    rawText,
    metadata = {},
  ) {
    const db = getDatabase();
    const id = randomUUID();
    const normalizedText = rawText.normalize("NFKC");
    const wordCount = (rawText.match(/\S+/g) ?? []).length;
    const characterCount = rawText.length;
    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(metadata);

    const insertDocStmt = db.prepare(`
      INSERT INTO corpus_documents (
        id, title, author, source_type, file_name, file_path, file_hash, file_type,
        raw_text, normalized_text, word_count, character_count, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDocStmt.run(
      id,
      title,
      author,
      sourceType,
      fileName,
      filePath,
      fileHash,
      fileType,
      rawText,
      normalizedText,
      wordCount,
      characterCount,
      metadataJson,
      now,
      now,
    );

    // Incremental Indexing
    this.indexDocument(id, rawText);

    return {
      id,
      title,
      author,
      sourceType,
      fileName,
      filePath,
      fileHash,
      fileType,
      rawText,
      normalizedText,
      wordCount,
      characterCount,
      metadataJson,
      createdAt: now,
      updatedAt: now,
    };
  }

  static indexDocument(docId, text) {
    const db = getDatabase();
    const tokens = tokenizeWithOffsets(text);
    const shingles = createShingles(tokens, similarityConfig.defaultShingleSize);

    db.prepare("DELETE FROM corpus_index WHERE doc_id = ?").run(docId);

    if (shingles.length === 0) return;

    db.exec("BEGIN TRANSACTION;");
    try {
      const insertIndexStmt = db.prepare(`
        INSERT OR IGNORE INTO corpus_index (shingle_hash, doc_id, position)
        VALUES (?, ?, ?)
      `);

      for (const shingle of shingles) {
        insertIndexStmt.run(shingle.hash, docId, shingle.tokenStartIndex);
      }
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }

  static findMatchesForShingles(shingles) {
    const db = getDatabase();
    const resultMap = new Map();
    if (shingles.length === 0) return resultMap;

    const uniqueHashes = Array.from(new Set(shingles.map((s) => s.hash)));
    const batchSize = 400;

    for (let i = 0; i < uniqueHashes.length; i += batchSize) {
      const batch = uniqueHashes.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(",");
      const stmt = db.prepare(`
        SELECT shingle_hash, doc_id, position
        FROM corpus_index
        WHERE shingle_hash IN (${placeholders})
      `);

      const rows = stmt.all(...batch);
      for (const row of rows) {
        const hash = row.shingle_hash;
        let list = resultMap.get(hash);
        if (!list) {
          list = [];
          resultMap.set(hash, list);
        }
        list.push({
          shingleHash: hash,
          docId: row.doc_id,
          position: row.position,
        });
      }
    }

    return resultMap;
  }

  static listDocuments() {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, title, author, source_type as sourceType, file_name as fileName,
             file_path as filePath, file_hash as fileHash, file_type as fileType,
             raw_text as rawText, normalized_text as normalizedText,
             word_count as wordCount, character_count as characterCount,
             metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
      FROM corpus_documents
      ORDER BY created_at DESC
    `);
    return stmt.all() ?? [];
  }

  static getDocumentById(id) {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, title, author, source_type as sourceType, file_name as fileName,
             file_path as filePath, file_hash as fileHash, file_type as fileType,
             raw_text as rawText, normalized_text as normalizedText,
             word_count as wordCount, character_count as characterCount,
             metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
      FROM corpus_documents
      WHERE id = ?
    `);
    const doc = stmt.get(id);
    return doc ?? null;
  }

  static getDocumentByHash(fileHash) {
    const db = getDatabase();
    const stmt = db.prepare("SELECT id, title FROM corpus_documents WHERE file_hash = ?");
    const doc = stmt.get(fileHash);
    return doc ?? null;
  }

  static deleteDocument(id) {
    const db = getDatabase();
    const res = db.prepare("DELETE FROM corpus_documents WHERE id = ?").run(id);
    return res.changes > 0;
  }

  static getCorpusStats() {
    const db = getDatabase();
    const docStats = db.prepare("SELECT COUNT(*) as totalDocs, COALESCE(SUM(word_count), 0) as totalWords FROM corpus_documents").get();
    const indexStats = db.prepare("SELECT COUNT(*) as indexedShingles FROM corpus_index").get();

    return {
      totalDocs: docStats.totalDocs,
      totalWords: docStats.totalWords,
      indexedShingles: indexStats.indexedShingles,
    };
  }

  static rebuildAllIndexes() {
    const docs = this.listDocuments();
    for (const doc of docs) {
      this.indexDocument(doc.id, doc.rawText);
    }
  }
}

