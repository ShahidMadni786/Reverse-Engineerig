import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";

export class ReportRepository {
  static saveReport(submissionId, result) {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();
    const metricsJson = JSON.stringify(result.metrics);
    const matchesJson = JSON.stringify(result.matches);
    const sourcesJson = JSON.stringify(result.sources);
    const exclusionsUsedJson = JSON.stringify(result.exclusions);

    db.prepare("DELETE FROM reports WHERE submission_id = ?").run(submissionId);

    const stmt = db.prepare(`
      INSERT INTO reports (
        id, submission_id, overall_score, highest_source_score, matched_words_count,
        total_words_count, metrics_json, matches_json, sources_json, exclusions_used_json,
        summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      submissionId,
      result.overallScore,
      result.highestSourceScore,
      result.matchedWordsCount,
      result.totalWordsCount,
      metricsJson,
      matchesJson,
      sourcesJson,
      exclusionsUsedJson,
      result.summary,
      now,
    );

    return {
      id,
      submissionId,
      overallScore: result.overallScore,
      highestSourceScore: result.highestSourceScore,
      matchedWordsCount: result.matchedWordsCount,
      totalWordsCount: result.totalWordsCount,
      metricsJson,
      matchesJson,
      sourcesJson,
      exclusionsUsedJson,
      summary: result.summary,
      createdAt: now,
    };
  }

  static getReportBySubmissionId(submissionId) {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, submission_id as submissionId, overall_score as overallScore,
             highest_source_score as highestSourceScore, matched_words_count as matchedWordsCount,
             total_words_count as totalWordsCount, metrics_json as metricsJson,
             matches_json as matchesJson, sources_json as sourcesJson,
             exclusions_used_json as exclusionsUsedJson, summary, created_at as createdAt
      FROM reports
      WHERE submission_id = ?
    `);
    const row = stmt.get(submissionId);
    return row ?? null;
  }

  static getReportById(id) {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, submission_id as submissionId, overall_score as overallScore,
             highest_source_score as highestSourceScore, matched_words_count as matchedWordsCount,
             total_words_count as totalWordsCount, metrics_json as metricsJson,
             matches_json as matchesJson, sources_json as sourcesJson,
             exclusions_used_json as exclusionsUsedJson, summary, created_at as createdAt
      FROM reports
      WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ?? null;
  }

  static deleteReport(id) {
    const db = getDatabase();
    const res = db.prepare("DELETE FROM reports WHERE id = ?").run(id);
    return res.changes > 0;
  }

  static getAverageScore() {
    const db = getDatabase();
    const row = db.prepare("SELECT AVG(overall_score) as avgScore FROM reports").get();
    return row.avgScore !== null ? Number(row.avgScore.toFixed(1)) : 0;
  }
}
