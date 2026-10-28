const SOURCE_COLORS = [
  "#ef4444", // Red
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
];

class AcademicSimilarityApp {
  constructor() {
    this.token = localStorage.getItem("sim_token") || null;
    this.currentUser = {
      id: "admin",
      username: "admin",
      role: "admin",
      full_name: "System Administrator",
    };
    this.currentReport = null;
    this.currentSubmission = null;
    this.selectedFiles = {
      sub: null,
      corpus: null,
    };
  }

  async init() {
    this.setupTabs();
    this.setupDragAndDrop();
    await this.refreshAll();
  }

  setupTabs() {
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll(".nav-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `tab-${tabId}`);
    });

    if (tabId === "dashboard") {
      this.loadStats();
      this.loadSubmissions();
    } else if (tabId === "submissions") {
      this.loadSubmissions();
    } else if (tabId === "corpus") {
      this.loadCorpus();
    } else if (tabId === "users") {
      this.loadUsers();
    }
  }

  setupDragAndDrop() {
    const dropzone = document.getElementById("sub-dropzone");
    if (!dropzone) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      });
    });

    dropzone.addEventListener("drop", (e) => {
      const files = e.dataTransfer.files;
      if (files && files[0]) {
        this.selectedFiles.sub = files[0];
        document.getElementById("sub-file-label").textContent = `Selected: ${files[0].name} (${(files[0].size / 1024).toFixed(1)} KB)`;
        if (!document.getElementById("sub-title").value) {
          document.getElementById("sub-title").value = files[0].name.replace(/\.[^/.]+$/, "");
        }
      }
    });
  }

  handleFileSelect(event, type) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFiles[type] = file;
      if (type === "sub") {
        document.getElementById("sub-file-label").textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        if (!document.getElementById("sub-title").value) {
          document.getElementById("sub-title").value = file.name.replace(/\.[^/.]+$/, "");
        }
      }
    }
  }

  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  async refreshAll() {
    await Promise.all([this.loadStats(), this.loadSubmissions(), this.loadCorpus()]);
  }

  async loadStats() {
    try {
      const res = await fetch("/api/system/stats");
      const data = await res.json();
      document.getElementById("stat-corpus-docs").textContent = data.corpus.totalDocs;
      document.getElementById("stat-corpus-words").textContent = `${data.corpus.totalWords.toLocaleString()} indexed words`;
      document.getElementById("stat-indexed-shingles").textContent = data.corpus.indexedShingles.toLocaleString();
      document.getElementById("stat-submissions").textContent = data.submissions.totalSubmissions;
      document.getElementById("stat-completed-subs").textContent = `${data.submissions.completedCount} completed`;
      document.getElementById("stat-avg-similarity").textContent = `${data.averageSimilarity}%`;
      document.getElementById("corpus-count-badge").textContent = `${data.corpus.totalDocs} documents`;
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }

  async loadSubmissions() {
    try {
      const res = await fetch("/api/submissions");
      const data = await res.json();
      const subs = data.submissions || [];
      this.renderSubmissionsTable("recent-submissions-tbody", subs.slice(0, 5));
      this.renderSubmissionsTable("all-submissions-tbody", subs);
    } catch (err) {
      console.error("Failed to load submissions:", err);
    }
  }

  renderSubmissionsTable(tbodyId, subs) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (subs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--text-muted); padding:2rem;">No submissions yet. Submit your first document to run similarity checks.</td></tr>`;
      return;
    }

    tbody.innerHTML = subs
      .map((sub) => {
        let statusBadge = `<span class="badge badge-completed">Completed</span>`;
        if (sub.status === "pending" || sub.status === "processing") {
          statusBadge = `<span class="badge badge-pending">${sub.status}</span>`;
        } else if (sub.status === "failed") {
          statusBadge = `<span class="badge badge-failed">Failed</span>`;
        }

        const dateStr = new Date(sub.createdAt).toLocaleDateString();

        return `<tr>
          <td><strong>${this.escape(sub.title)}</strong></td>
          <td>${this.escape(sub.author || "Unknown")}</td>
          <td><span class="badge" style="background:#334155;">.${sub.fileType.toUpperCase()}</span></td>
          <td>${sub.wordCount.toLocaleString()}</td>
          <td>${statusBadge}</td>
          <td id="score-cell-${sub.id}"><span class="badge">Checking...</span></td>
          <td>${dateStr}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="app.viewReport('${sub.id}')">View Report</button>
            <button class="btn btn-danger btn-sm" onclick="app.deleteSubmission('${sub.id}')" style="margin-left:4px;">&times;</button>
          </td>
        </tr>`;
      })
      .join("");

    // Load reports for each submission to show similarity pills
    subs.forEach(async (sub) => {
      try {
        const rRes = await fetch(`/api/submissions/${sub.id}`);
        const rData = await rRes.json();
        const scoreCell = document.getElementById(`score-cell-${sub.id}`);
        if (scoreCell) {
          if (rData.report) {
            const score = rData.report.overallScore;
            const level = score > 30 ? "high" : score > 15 ? "medium" : "low";
            scoreCell.innerHTML = `<span class="score-pill ${level}">${score}%</span>`;
          } else {
            scoreCell.innerHTML = `<span class="text-muted">—</span>`;
          }
        }
      } catch (e) {
        // Ignore
      }
    });
  }

  async handleSubmission(event) {
    event.preventDefault();
    const btn = document.getElementById("sub-submit-btn");
    btn.disabled = true;
    btn.querySelector(".btn-text").textContent = "Analyzing Document & Corpus...";

    try {
      const title = document.getElementById("sub-title").value;
      const author = document.getElementById("sub-author").value;
      const directText = document.getElementById("sub-direct-text").value;
      const excludeBib = document.getElementById("sub-exclude-bib").checked;
      const excludeQuotes = document.getElementById("sub-exclude-quotes").checked;
      const excludeSmall = document.getElementById("sub-exclude-small").checked;
      const threshold = parseInt(document.getElementById("sub-threshold").value, 10) || 8;

      let fileBase64 = null;
      let fileName = "submission.txt";

      if (this.selectedFiles.sub) {
        fileBase64 = await this.fileToBase64(this.selectedFiles.sub);
        fileName = this.selectedFiles.sub.name;
      }

      if (!fileBase64 && (!directText || directText.trim().length === 0)) {
        alert("Please provide a file or paste document text.");
        btn.disabled = false;
        btn.querySelector(".btn-text").textContent = "Run Similarity Analysis";
        return;
      }

      const payload = {
        title,
        author,
        fileName,
        text: directText,
        fileBase64,
        settings: {
          excludeBibliography: excludeBib,
          excludeQuotes: excludeQuotes,
          excludeSmallMatches: excludeSmall,
          smallMatchThreshold: threshold,
        },
      };

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Submission failed");
      }

      // Reset form
      document.getElementById("submission-form").reset();
      this.selectedFiles.sub = null;
      document.getElementById("sub-file-label").textContent = "Click or drag & drop a file here (.PDF, .DOCX, or .TXT)";

      await this.refreshAll();
      this.switchTab("submissions");
      this.viewReport(data.submission.id);
    } catch (err) {
      alert("Error running analysis: " + err.message);
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-text").textContent = "Run Similarity Analysis";
    }
  }

  async viewReport(submissionId) {
    try {
      const res = await fetch(`/api/submissions/${submissionId}`);
      const data = await res.json();
      if (!data.submission || !data.report) {
        alert("Report is not ready yet or analysis failed.");
        return;
      }

      this.currentSubmission = data.submission;
      this.currentReport = data.report;

      document.getElementById("rep-title").textContent = `Similarity Report: ${data.submission.title}`;
      document.getElementById("rep-meta").textContent = `Author: ${data.submission.author || "Unknown"} | Format: .${data.submission.fileType.toUpperCase()} | Submissions ID: ${data.submission.id.substring(0, 8)}`;
      document.getElementById("rep-word-count").textContent = `${data.submission.wordCount} words`;

      // Set score badge
      const score = data.report.overallScore;
      const scoreCard = document.getElementById("rep-score-card");
      scoreCard.className = `score-card ${score > 30 ? "high" : score > 15 ? "medium" : "low"}`;
      document.getElementById("rep-overall-score").textContent = `${score}%`;
      document.getElementById("rep-score-subtext").textContent = `${data.report.matchedWordsCount} of ${data.report.totalWordsCount} words matched across corpus`;

      // Set exclusion checkboxes from report
      const exclusions = JSON.parse(data.report.exclusionsUsedJson);
      const applied = exclusions.appliedSettings || {};
      document.getElementById("rep-filter-bib").checked = applied.excludeBibliography ?? true;
      document.getElementById("rep-filter-quotes").checked = applied.excludeQuotes ?? false;
      document.getElementById("rep-filter-small").checked = applied.excludeSmallMatches ?? true;

      this.renderReportContent(data.submission, data.report);
      document.getElementById("report-modal").classList.add("open");
    } catch (err) {
      alert("Failed to load report: " + err.message);
    }
  }

  renderReportContent(submission, report) {
    const matches = JSON.parse(report.matchesJson);
    const sources = JSON.parse(report.sourcesJson);

    // Map source colors
    const sourceColorMap = new Map();
    sources.forEach((s, idx) => {
      sourceColorMap.set(s.sourceDocId, SOURCE_COLORS[idx % SOURCE_COLORS.length]);
    });

    // Render sources list
    document.getElementById("rep-sources-count").textContent = sources.length;
    const sourcesList = document.getElementById("rep-sources-list");
    if (sources.length === 0) {
      sourcesList.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">No matching passages found in the local corpus.</p>`;
    } else {
      sourcesList.innerHTML = sources
        .map((s) => {
          const color = sourceColorMap.get(s.sourceDocId) || "#3b82f6";
          return `<div class="source-item" onclick="app.filterMatchesBySource('${s.sourceDocId}')">
            <div class="source-item-header">
              <span class="source-item-title"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span>${this.escape(s.title)}</span>
              <span class="source-item-percent" style="color:${color};">${s.similarityPercent}%</span>
            </div>
            <div class="source-item-meta">
              ${s.matchedWords} words &bull; ${s.matchCount} passage(s) &bull; Jaccard: ${(s.jaccardScore * 100).toFixed(0)}%
            </div>
          </div>`;
        })
        .join("");
    }

    // Render highlighted document text
    matches.sort((a, b) => a.charStart - b.charStart);
    let html = "";
    let lastIndex = 0;
    const raw = submission.rawText;

    matches.forEach((m, idx) => {
      if (m.charStart < lastIndex) return; // avoid overlapping breaks

      html += this.escape(raw.substring(lastIndex, m.charStart));

      const color = sourceColorMap.get(m.sourceDocId) || "#f59e0b";
      const matchedSnippet = this.escape(raw.substring(m.charStart, m.charEnd));
      html += `<mark id="match-span-${idx}" class="similarity-highlight" data-source-id="${m.sourceDocId}" style="background-color:${color}30; border-bottom:2px solid ${color};" title="Matched in: ${this.escape(m.sourceDocTitle)}">${matchedSnippet}</mark>`;

      lastIndex = m.charEnd;
    });
    html += this.escape(raw.substring(lastIndex));

    document.getElementById("rep-doc-text").innerHTML = html.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
  }

  filterMatchesBySource(sourceId) {
    const marks = document.querySelectorAll(".similarity-highlight");
    let firstFound = null;

    marks.forEach((m) => {
      if (m.dataset.sourceId === sourceId) {
        m.style.opacity = "1";
        m.style.outline = "2px solid white";
        if (!firstFound) firstFound = m;
      } else {
        m.style.opacity = "0.2";
        m.style.outline = "none";
      }
    });

    if (firstFound) {
      firstFound.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async recalculateReport() {
    if (!this.currentSubmission) return;

    const excludeBib = document.getElementById("rep-filter-bib").checked;
    const excludeQuotes = document.getElementById("rep-filter-quotes").checked;
    const excludeSmall = document.getElementById("rep-filter-small").checked;

    try {
      const res = await fetch(`/api/reports/${this.currentSubmission.id}/recalculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            excludeBibliography: excludeBib,
            excludeQuotes: excludeQuotes,
            excludeSmallMatches: excludeSmall,
            smallMatchThreshold: 8,
          },
        }),
      });

      const data = await res.json();
      this.currentReport = data.report;

      const score = data.report.overallScore;
      const scoreCard = document.getElementById("rep-score-card");
      scoreCard.className = `score-card ${score > 30 ? "high" : score > 15 ? "medium" : "low"}`;
      document.getElementById("rep-overall-score").textContent = `${score}%`;
      document.getElementById("rep-score-subtext").textContent = `${data.report.matchedWordsCount} of ${data.report.totalWordsCount} words matched across corpus`;

      this.renderReportContent(this.currentSubmission, data.report);
    } catch (err) {
      alert("Error recalculating report: " + err.message);
    }
  }

  closeReportModal() {
    document.getElementById("report-modal").classList.remove("open");
  }

  exportReport(type) {
    if (!this.currentSubmission) return;
    window.location.href = `/api/reports/${this.currentSubmission.id}/export/${type}`;
  }

  async deleteSubmission(id) {
    if (!confirm("Are you sure you want to delete this submission and its report?")) return;
    try {
      await fetch(`/api/submissions/${id}`, { method: "DELETE" });
      await this.refreshAll();
    } catch (err) {
      alert("Failed to delete submission: " + err.message);
    }
  }

  // Corpus Methods
  async loadCorpus() {
    try {
      const res = await fetch("/api/corpus");
      const data = await res.json();
      const docs = data.documents || [];
      const tbody = document.getElementById("corpus-tbody");
      if (!tbody) return;

      if (docs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-muted); padding:2rem;">Local corpus is currently empty. Add authorized documents or papers to build your local comparison database.</td></tr>`;
        return;
      }

      tbody.innerHTML = docs
        .map((doc) => {
          const dateStr = new Date(doc.createdAt).toLocaleDateString();
          return `<tr>
            <td><strong>${this.escape(doc.title)}</strong></td>
            <td>${this.escape(doc.author || "—")}</td>
            <td><span class="badge" style="background:#334155; text-transform:capitalize;">${doc.sourceType}</span></td>
            <td><span class="badge" style="background:#1e293b; border:1px solid #475569;">.${doc.fileType.toUpperCase()}</span></td>
            <td>${doc.wordCount.toLocaleString()}</td>
            <td>${dateStr}</td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="app.deleteCorpusDoc('${doc.id}')">Delete</button>
            </td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error("Failed to load corpus:", err);
    }
  }

  openCorpusModal() {
    document.getElementById("corpus-modal").classList.add("open");
  }

  closeCorpusModal() {
    document.getElementById("corpus-modal").classList.remove("open");
  }

  async handleCorpusUpload(event) {
    event.preventDefault();
    const btn = document.getElementById("corpus-submit-btn");
    btn.disabled = true;
    btn.textContent = "Indexing into Corpus...";

    try {
      const title = document.getElementById("corpus-title").value;
      const author = document.getElementById("corpus-author").value;
      const sourceType = document.getElementById("corpus-source-type").value;
      const text = document.getElementById("corpus-text").value;

      let fileBase64 = null;
      let fileName = "corpus-doc.txt";

      if (this.selectedFiles.corpus) {
        fileBase64 = await this.fileToBase64(this.selectedFiles.corpus);
        fileName = this.selectedFiles.corpus.name;
      }

      if (!fileBase64 && (!text || text.trim().length === 0)) {
        alert("Please provide a file or text content.");
        btn.disabled = false;
        btn.textContent = "Index into Corpus";
        return;
      }

      const res = await fetch("/api/corpus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          author,
          sourceType,
          fileName,
          text,
          fileBase64,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add document to corpus");
      }

      this.closeCorpusModal();
      document.getElementById("corpus-title").value = "";
      document.getElementById("corpus-author").value = "";
      document.getElementById("corpus-text").value = "";
      document.getElementById("corpus-file-input").value = "";
      this.selectedFiles.corpus = null;

      await this.refreshAll();
    } catch (err) {
      alert("Error adding document: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Index into Corpus";
    }
  }

  async deleteCorpusDoc(id) {
    if (!confirm("Are you sure you want to remove this document from the local corpus?")) return;
    try {
      await fetch(`/api/corpus/${id}`, { method: "DELETE" });
      await this.refreshAll();
    } catch (err) {
      alert("Failed to delete document: " + err.message);
    }
  }

  async rebuildCorpusIndex() {
    if (!confirm("Rebuild the inverted index for all corpus documents?")) return;
    try {
      const res = await fetch("/api/corpus/reindex", { method: "POST" });
      const data = await res.json();
      alert(data.message || "Index rebuilt!");
      await this.refreshAll();
    } catch (err) {
      alert("Failed to rebuild index: " + err.message);
    }
  }

  // Users & RBAC Methods
  async loadUsers() {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      const users = data.users || [];
      const tbody = document.getElementById("users-tbody");
      if (!tbody) return;

      tbody.innerHTML = users
        .map((u) => {
          return `<tr>
            <td><strong>${this.escape(u.full_name)}</strong></td>
            <td>${this.escape(u.username)}</td>
            <td>${this.escape(u.email)}</td>
            <td><span class="role-badge">${u.role}</span></td>
            <td>${new Date(u.created_at).toLocaleDateString()}</td>
            <td>
              ${u.username === "admin" ? '<span class="text-muted">Protected</span>' : `<button class="btn btn-danger btn-sm" onclick="app.deleteUser('${u.id}')">Delete</button>`}
            </td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error("Failed to load users:", err);
    }
  }

  openUserModal() {
    document.getElementById("user-modal").classList.add("open");
  }

  closeUserModal() {
    document.getElementById("user-modal").classList.remove("open");
  }

  async handleUserCreate(event) {
    event.preventDefault();
    try {
      const username = document.getElementById("usr-username").value;
      const fullName = document.getElementById("usr-fullname").value;
      const email = document.getElementById("usr-email").value;
      const password = document.getElementById("usr-password").value;
      const role = document.getElementById("usr-role").value;

      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, fullName, email, password, role }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");

      this.closeUserModal();
      await this.loadUsers();
    } catch (err) {
      alert("Error creating user: " + err.message);
    }
  }

  async deleteUser(id) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await fetch(`/api/users/${id}`, { method: "DELETE" });
      await this.loadUsers();
    } catch (err) {
      alert("Failed to delete user: " + err.message);
    }
  }

  escape(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

const app = new AcademicSimilarityApp();
window.app = app;
document.addEventListener("DOMContentLoaded", () => app.init());
