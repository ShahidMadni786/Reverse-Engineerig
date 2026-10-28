import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";

export class SubmissionRepository {
  static createSubmission(
    userId,
    title,
    author,
    fileName,
    filePath,
    fileHash,
    fileType,
    rawText,
    settings = {},
  ) {
    const db = getDatabase();
    const id = randomUUID();
    const normalizedText = rawText.normalize("NFKC");
    const wordCount = (rawText.match(/\S+/g) ?? []).length;
    const characterCount = rawText.length;
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(settings);

    const stmt = db.prepare(`
      INSERT INTO submissions (
        id, user_id, title, author, file_name, file_path, file_hash, file_type,
        raw_text, normalized_text, word_count, character_count, status, settings_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    stmt.run(
      id,
      userId,
      title,
      author,
      fileName,
      filePath,
      fileHash,
      fileType,
      rawText,
      normalizedText,
      wordCount,
      characterCount,
      settingsJson,
      now,
    );

    return {
      id,
      userId,
      title,
      author,
      fileName,
      filePath,
      fileHash,
      fileType,
      rawText,
      normalizedText,
      wordCount,
      characterCount,
      status: "pending",
      errorMessage: null,
      settingsJson,
      createdAt: now,
      completedAt: null,
    };
  }

  static getSubmissionById(id) {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, title, author, file_name as fileName,
             file_path as filePath, file_hash as fileHash, file_type as fileType,
             raw_text as rawText, normalized_text as normalizedText,
             word_count as wordCount, character_count as characterCount,
             status, error_message as errorMessage, settings_json as settingsJson,
             created_at as createdAt, completed_at as completedAt
      FROM submissions
      WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ?? null;
  }

  static listSubmissions(userId) {
    const db = getDatabase();
    let stmt;
    if (userId) {
      stmt = db.prepare(`
        SELECT id, user_id as userId, title, author, file_name as fileName,
               file_path as filePath, file_hash as fileHash, file_type as fileType,
               raw_text as rawText, normalized_text as normalizedText,
               word_count as wordCount, character_count as characterCount,
               status, error_message as errorMessage, settings_json as settingsJson,
               created_at as createdAt, completed_at as completedAt
        FROM submissions
        WHERE user_id = ?
        ORDER BY created_at DESC
      `);
      return stmt.all(userId) ?? [];
    } else {
      stmt = db.prepare(`
        SELECT id, user_id as userId, title, author, file_name as fileName,
               file_path as filePath, file_hash as fileHash, file_type as fileType,
               raw_text as rawText, normalized_text as normalizedText,
               word_count as wordCount, character_count as characterCount,
               status, error_message as errorMessage, settings_json as settingsJson,
               created_at as createdAt, completed_at as completedAt
        FROM submissions
        ORDER BY created_at DESC
      `);
      return stmt.all() ?? [];
    }
  }

  static updateStatus(id, status, errorMessage) {
    const db = getDatabase();
    const now = new Date().toISOString();
    if (status === "completed" || status === "failed") {
      db.prepare(`
        UPDATE submissions
        SET status = ?, error_message = ?, completed_at = ?
        WHERE id = ?
      `).run(status, errorMessage ?? null, now, id);
    } else {
      db.prepare(`
        UPDATE submissions
        SET status = ?, error_message = ?
        WHERE id = ?
      `).run(status, errorMessage ?? null, id);
    }
  }

  static deleteSubmission(id) {
    const db = getDatabase();
    const res = db.prepare("DELETE FROM submissions WHERE id = ?").run(id);
    return res.changes > 0;
  }

  static getStats() {
    const db = getDatabase();
    const total = db.prepare("SELECT COUNT(*) as count FROM submissions").get();
    const completed = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'completed'").get();
    const pending = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'pending' OR status = 'processing'").get();

    return {
      totalSubmissions: total.count,
      completedCount: completed.count,
      pendingCount: pending.count,
    };
  }
}

