import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { similarityConfig } from "../config/similarityConfig.js";
import { UserRepository } from "../db/userRepository.js";
import { CorpusRepository } from "../db/corpusRepository.js";
import { SubmissionRepository } from "../db/submissionRepository.js";
import { ReportRepository } from "../db/reportRepository.js";
import { extractDocument } from "../extractors/documentExtractor.js";
import { SimilarityEngine } from "../engine/similarityEngine.js";
import { exportHtmlReport } from "../reporting/htmlExporter.js";
import { verifyPassword } from "../auth/passwords.js";

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export class SimilarityHttpServer {
  constructor() {
    this.server = null;
  }

  start(port = similarityConfig.port, host = similarityConfig.host) {
    return new Promise((resolvePromise, reject) => {
      UserRepository.ensureDefaultUsers();
      CorpusRepository.ensureIndexVersion();

      const server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err) {
          const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
          const message = status < 500 ? err.message : "Internal Server Error";
          this.sendJson(res, status, { error: message });
        }
      });

      server.listen(port, host, () => {
        this.server = server;
        const address = server.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        resolvePromise(actualPort);
      });

      server.on("error", (err) => {
        reject(err);
      });
    });
  }

  stop() {
    return new Promise((resolvePromise) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolvePromise();
        });
      } else {
        resolvePromise();
      }
    });
  }

  async handleRequest(req, res) {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsed.pathname;
    const query = Object.fromEntries(parsed.searchParams.entries());

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const user = UserRepository.validateSession(token);
      if (user) {
        req.user = user;
      }
    }

    if (pathname.startsWith("/api/")) {
      if (pathname !== "/api/auth/login" && !req.user) {
        this.sendJson(res, 401, { error: "Sign in is required" });
        return;
      }
      await this.handleApiRoute(pathname, req, res, query);
      return;
    }

    this.serveStatic(pathname, res);
  }

  async handleApiRoute(pathname, req, res, query) {
    const method = req.method ?? "GET";
    const role = req.user?.role;
    const isAdmin = role === "admin";
    const canManageCorpus = isAdmin || role === "instructor";

    if (pathname.startsWith("/api/users") && !isAdmin) {
      this.sendJson(res, 403, { error: "Administrator access is required" });
      return;
    }
    if (pathname.startsWith("/api/corpus") && !canManageCorpus) {
      this.sendJson(res, 403, { error: "Instructor access is required" });
      return;
    }
    if (
      pathname.startsWith("/api/reports/") &&
      !isAdmin &&
      role !== "instructor"
    ) {
      const submissionId = pathname.split("/")[3];
      const submission = SubmissionRepository.getSubmissionById(submissionId);
      if (!submission || submission.userId !== req.user?.id) {
        this.sendJson(res, 403, { error: "You cannot access this report" });
        return;
      }
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await this.readJsonBody(req);
      if (!body.username || !body.password) {
        this.sendJson(res, 400, { error: "Username and password are required" });
        return;
      }
      const record = UserRepository.findByUsername(body.username);
      if (!record || !verifyPassword(body.password, record.password_hash, record.salt)) {
        this.sendJson(res, 401, { error: "Invalid username or password" });
        return;
      }
      const session = UserRepository.createSession(record.id);
      this.sendJson(res, 200, {
        token: session.token,
        user: {
          id: record.id,
          username: record.username,
          email: record.email,
          role: record.role,
          full_name: record.full_name,
        },
      });
      return;
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      if (!req.user) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(res, 200, { user: req.user });
      return;
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      if (req.user) {
        const token = req.headers["authorization"]?.substring(7);
        if (token) UserRepository.revokeSession(token);
      }
      this.sendJson(res, 200, { success: true });
      return;
    }

    if (pathname === "/api/system/stats" && method === "GET") {
      const corpusStats = CorpusRepository.getCorpusStats();
      const submissionStats = SubmissionRepository.getStats();
      const avgScore = ReportRepository.getAverageScore();
      this.sendJson(res, 200, {
        corpus: corpusStats,
        submissions: submissionStats,
        averageSimilarity: avgScore,
        system: {
          storagePath: similarityConfig.dataDir,
          offlineMode: true,
          status: "healthy",
        },
      });
      return;
    }

    if (pathname === "/api/corpus" && method === "GET") {
      const docs = CorpusRepository.listDocuments();
      this.sendJson(res, 200, { documents: docs });
      return;
    }

    if (pathname === "/api/corpus" && method === "POST") {
      const body = await this.readJsonBody(req);

      let textContent = body.text ?? "";
      let fileName = body.fileName ?? "document.txt";
      let fileType = "txt";
      let metadata = {};

      if (body.fileBase64) {
        const buffer = Buffer.from(body.fileBase64, "base64");
        const processed = extractDocument(fileName, buffer);
        textContent = processed.rawText;
        fileType = processed.fileType;
        metadata = processed.metadata;
      }

      if (!textContent || textContent.trim().length === 0) {
        this.sendJson(res, 400, { error: "Document text content cannot be empty" });
        return;
      }

      const title = body.title?.trim() || fileName;
      const author = body.author?.trim() || null;
      const sourceType = body.sourceType || "academic";
      const fileHash = createHash("sha256").update(textContent).digest("hex");

      const existing = CorpusRepository.getDocumentByHash(fileHash);
      if (existing) {
        this.sendJson(res, 409, { error: "A document with identical content is already indexed in the corpus" });
        return;
      }

      const doc = CorpusRepository.addDocument(
        title,
        author,
        sourceType,
        fileName,
        "local://corpus/" + fileName,
        fileHash,
        fileType,
        textContent,
        metadata,
      );

      this.sendJson(res, 201, { document: doc });
      return;
    }

    if (pathname.startsWith("/api/corpus/") && method === "DELETE") {
      const id = pathname.substring("/api/corpus/".length);
      const deleted = CorpusRepository.deleteDocument(id);
      if (!deleted) {
        this.sendJson(res, 404, { error: "Corpus document not found" });
        return;
      }
      this.sendJson(res, 200, { success: true });
      return;
    }

    if (pathname === "/api/corpus/reindex" && method === "POST") {
      CorpusRepository.rebuildAllIndexes();
      this.sendJson(res, 200, { success: true, message: "Corpus index rebuilt successfully." });
      return;
    }

    if (pathname === "/api/submissions" && method === "GET") {
      const userId = req.user?.role === "student" ? req.user.id : undefined;
      const subs = SubmissionRepository.listSubmissions(userId);
      this.sendJson(res, 200, { submissions: subs });
      return;
    }

    if (pathname === "/api/submissions" && method === "POST") {
      try {
        const body = await this.readJsonBody(req);

        let textContent = body.text ?? "";
        let fileName = body.fileName ?? "submission.txt";
        let fileType = "txt";

        if (body.fileBase64) {
          try {
            const buffer = Buffer.from(body.fileBase64, "base64");
            const processed = extractDocument(fileName, buffer);
            textContent = processed.rawText;
            fileType = processed.fileType;
          } catch (extractErr) {
            const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
            this.sendJson(res, 400, { error: `Document processing error: ${msg}` });
            return;
          }
        }

        if (!textContent || textContent.trim().length === 0) {
          this.sendJson(res, 400, { error: "Submission text content cannot be empty" });
          return;
        }

        const title = body.title?.trim() || fileName;
        const author = body.author?.trim() || req.user?.full_name || "Unknown Author";

        // Resolve valid user ID in database
        const userId = req.user.id;

        const fileHash = createHash("sha256").update(textContent).digest("hex");

        const submission = SubmissionRepository.createSubmission(
          userId,
          title,
          author,
          fileName,
          "local://submissions/" + fileName,
          fileHash,
          fileType,
          textContent,
          body.settings ?? {},
        );

        SubmissionRepository.updateStatus(submission.id, "processing");

        const analysis = SimilarityEngine.analyze(textContent, body.settings);
        const report = ReportRepository.saveReport(submission.id, analysis);
        SubmissionRepository.updateStatus(submission.id, "completed");

        this.sendJson(res, 201, {
          submission: SubmissionRepository.getSubmissionById(submission.id),
          report,
          analysis,
        });
      } catch (err) {
        const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
        this.sendJson(res, status, {
          error: status < 500 ? err.message : "Analysis failed",
        });
      }
      return;
    }

    if (pathname.startsWith("/api/submissions/") && method === "GET") {
      const id = pathname.substring("/api/submissions/".length);
      const sub = SubmissionRepository.getSubmissionById(id);
      if (!sub) {
        this.sendJson(res, 404, { error: "Submission not found" });
        return;
      }
      if (req.user?.role === "student" && sub.userId !== req.user.id) {
        this.sendJson(res, 403, { error: "You cannot access this submission" });
        return;
      }
      const report = ReportRepository.getReportBySubmissionId(id);
      this.sendJson(res, 200, { submission: sub, report });
      return;
    }

    if (pathname.startsWith("/api/submissions/") && method === "DELETE") {
      const id = pathname.substring("/api/submissions/".length);
      const existing = SubmissionRepository.getSubmissionById(id);
      if (req.user?.role === "student" && existing?.userId !== req.user.id) {
        this.sendJson(res, 403, { error: "You cannot delete this submission" });
        return;
      }
      const deleted = SubmissionRepository.deleteSubmission(id);
      if (!deleted) {
        this.sendJson(res, 404, { error: "Submission not found" });
        return;
      }
      this.sendJson(res, 200, { success: true });
      return;
    }

    if (pathname.startsWith("/api/reports/") && pathname.endsWith("/export/html") && method === "GET") {
      const parts = pathname.split("/");
      const submissionId = parts[3];
      const sub = SubmissionRepository.getSubmissionById(submissionId);
      const report = ReportRepository.getReportBySubmissionId(submissionId);
      if (!sub || !report) {
        this.sendJson(res, 404, { error: "Report not found" });
        return;
      }
      const html = exportHtmlReport(sub, report);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="similarity-report-${sub.id}.html"`,
      });
      res.end(html);
      return;
    }

    if (pathname.startsWith("/api/reports/") && pathname.endsWith("/export/json") && method === "GET") {
      const parts = pathname.split("/");
      const submissionId = parts[3];
      const sub = SubmissionRepository.getSubmissionById(submissionId);
      const report = ReportRepository.getReportBySubmissionId(submissionId);
      if (!sub || !report) {
        this.sendJson(res, 404, { error: "Report not found" });
        return;
      }
      const exportData = {
        submission: sub,
        report: {
          ...report,
          matches: JSON.parse(report.matchesJson),
          sources: JSON.parse(report.sourcesJson),
          metrics: JSON.parse(report.metricsJson),
          exclusions: JSON.parse(report.exclusionsUsedJson),
        },
      };
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="similarity-report-${sub.id}.json"`,
      });
      res.end(JSON.stringify(exportData, null, 2));
      return;
    }

    if (pathname.startsWith("/api/reports/") && pathname.endsWith("/recalculate") && method === "POST") {
      const parts = pathname.split("/");
      const submissionId = parts[3];
      const sub = SubmissionRepository.getSubmissionById(submissionId);
      if (!sub) {
        this.sendJson(res, 404, { error: "Submission not found" });
        return;
      }
      const body = await this.readJsonBody(req);
      const analysis = SimilarityEngine.analyze(sub.rawText, body.settings);
      const updatedReport = ReportRepository.saveReport(sub.id, analysis);
      this.sendJson(res, 200, { report: updatedReport, analysis });
      return;
    }

    if (pathname === "/api/users" && method === "GET") {
      const users = UserRepository.listUsers();
      this.sendJson(res, 200, { users });
      return;
    }

    if (pathname === "/api/users" && method === "POST") {
      const body = await this.readJsonBody(req);
      if (!body.username || !body.email || !body.password) {
        this.sendJson(res, 400, { error: "Username, email, and password are required" });
        return;
      }
      const newUser = UserRepository.createUser(
        body.username,
        body.email,
        body.password,
        body.role ?? "student",
        body.fullName ?? body.username,
      );
      this.sendJson(res, 201, { user: newUser });
      return;
    }

    if (pathname.startsWith("/api/users/") && method === "DELETE") {
      const id = pathname.substring("/api/users/".length);
      const deleted = UserRepository.deleteUser(id);
      if (!deleted) {
        this.sendJson(res, 404, { error: "User not found" });
        return;
      }
      this.sendJson(res, 200, { success: true });
      return;
    }

    this.sendJson(res, 404, { error: "Endpoint not found" });
  }

  serveStatic(pathname, res) {
    const publicDir = resolve(process.cwd(), "src/similarity/ui/public");
    let safePath = pathname === "/" ? "/index.html" : pathname;
    let filePath = resolve(publicDir, "." + safePath);

    if (!existsSync(filePath)) {
      filePath = resolve(publicDir, "index.html");
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  }

  readJsonBody(req) {
    const maxBytes = 12 * 1024 * 1024;
    return new Promise((resolvePromise, reject) => {
      const chunks = [];
      let receivedBytes = 0;
      let tooLarge = false;
      req.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          tooLarge = true;
          return;
        }
        if (!tooLarge) chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooLarge) {
          const error = new Error("Request body exceeds the 12 MB limit");
          error.statusCode = 413;
          reject(error);
          return;
        }
        const data = Buffer.concat(chunks).toString("utf8");
        if (!data.trim()) {
          resolvePromise({});
          return;
        }
        try {
          resolvePromise(JSON.parse(data));
        } catch {
          const error = new Error("Invalid JSON body");
          error.statusCode = 400;
          reject(error);
        }
      });
      req.on("error", (err) => reject(err));
    });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }
}
