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

export function exportHtmlReport(submission, report) {
  const matches = JSON.parse(report.matchesJson);
  const sources = JSON.parse(report.sourcesJson);
  const metrics = JSON.parse(report.metricsJson || "{}");
  const comparisonAvailable = metrics.comparisonAvailable !== false;

  const sourceColorMap = new Map();
  sources.forEach((s, idx) => {
    sourceColorMap.set(s.sourceDocId, SOURCE_COLORS[idx % SOURCE_COLORS.length]);
  });

  matches.sort((a, b) => a.charStart - b.charStart);

  let highlightedHtml = "";
  let lastIndex = 0;
  const rawText = submission.rawText;

  for (const m of matches) {
    if (m.charStart < lastIndex) continue;

    highlightedHtml += escapeHtml(rawText.substring(lastIndex, m.charStart));

    const color = sourceColorMap.get(m.sourceDocId) ?? "#f59e0b";
    const title = escapeHtml(m.sourceDocTitle);
    const matchedText = escapeHtml(rawText.substring(m.charStart, m.charEnd));

    highlightedHtml += `<mark class="similarity-highlight" style="background-color: ${color}26; border-bottom: 2px solid ${color};" title="Source: ${title} (${m.matchType} match)">${matchedText}</mark>`;

    lastIndex = m.charEnd;
  }
  highlightedHtml += escapeHtml(rawText.substring(lastIndex));

  const formattedBody = highlightedHtml.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Academic Similarity Report: ${escapeHtml(submission.title)}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    .header {
      background: var(--card-bg);
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
    }
    .meta h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .meta p { color: var(--text-muted); font-size: 0.95rem; }
    .score-badge {
      text-align: center;
      padding: 1rem 1.75rem;
      border-radius: 12px;
      background: ${comparisonAvailable ? (report.overallScore > 30 ? "#ef444420" : report.overallScore > 15 ? "#f59e0b20" : "#10b98120") : "#64748b20"};
      border: 2px solid ${comparisonAvailable ? (report.overallScore > 30 ? "#ef4444" : report.overallScore > 15 ? "#f59e0b" : "#10b981") : "#64748b"};
    }
    .score-num {
      font-size: 2.75rem;
      font-weight: 800;
      color: ${comparisonAvailable ? (report.overallScore > 30 ? "#ef4444" : report.overallScore > 15 ? "#f59e0b" : "#10b981") : "#64748b"};
    }
    .score-label { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    .section-title { font-size: 1.25rem; margin: 1.5rem 0 1rem; font-weight: 600; }
    .sources-card {
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 500; }
    .color-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .doc-viewer {
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 2.5rem;
      font-size: 1.05rem;
      line-height: 1.8;
      color: #e2e8f0;
      white-space: pre-wrap;
    }
    .similarity-highlight {
      padding: 2px 4px;
      border-radius: 3px;
      font-weight: 500;
    }
    .summary-box {
      background: #1e293b80;
      border-left: 4px solid var(--primary);
      padding: 1rem 1.25rem;
      margin-bottom: 2rem;
      border-radius: 4px;
      font-size: 0.95rem;
      color: #cbd5e1;
    }
    .footer-note {
      text-align: center;
      margin-top: 3rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    @media print {
      body { background: #fff; color: #000; }
      .header, .sources-card, .doc-viewer { background: #fff; border: 1px solid #ccc; color: #000; }
      .meta p, th, .score-label { color: #555; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="meta">
        <h1>${escapeHtml(submission.title)}</h1>
        <p><strong>Author:</strong> ${escapeHtml(submission.author ?? "Unknown")} &bull; <strong>Date:</strong> ${new Date(report.createdAt).toLocaleString()}</p>
        <p><strong>Word Count:</strong> ${submission.wordCount} words &bull; <strong>Format:</strong> .${submission.fileType.toUpperCase()}</p>
      </div>
      <div class="score-badge">
        <div class="score-num">${comparisonAvailable ? report.overallScore + "%" : "Not compared"}</div>
        <div class="score-label">${comparisonAvailable ? "Similarity Index" : "Reference corpus required"}</div>
      </div>
    </div>

    <div class="summary-box">
      <strong>Evaluation Summary:</strong> ${escapeHtml(report.summary)}
    </div>

    <h2 class="section-title">Matched Sources (${sources.length})</h2>
    <div class="sources-card">
      ${
        sources.length === 0
          ? "<p style='color: var(--text-muted);'>No source matches detected.</p>"
          : `<table>
        <thead>
          <tr>
            <th>Source Document</th>
            <th>Type</th>
            <th>Author</th>
            <th>Similarity</th>
            <th>Matched Words</th>
            <th>Passages</th>
          </tr>
        </thead>
        <tbody>
          ${sources
            .map((s) => {
              const color = sourceColorMap.get(s.sourceDocId) ?? "#3b82f6";
              return `<tr>
                <td><span class="color-dot" style="background:${color};"></span><strong>${escapeHtml(s.title)}</strong></td>
                <td><span style="text-transform: capitalize;">${escapeHtml(s.sourceType)}</span></td>
                <td>${escapeHtml(s.author ?? "—")}</td>
                <td><strong>${s.similarityPercent}%</strong></td>
                <td>${s.matchedWords}</td>
                <td>${s.matchCount}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
      }
    </div>

    <h2 class="section-title">Document Inspection (Highlighted Matches)</h2>
    <div class="doc-viewer">
      <p>${formattedBody}</p>
    </div>

    <div class="footer-note">
      <p>Generated by Local Academic Similarity Platform &bull; Independent Offline Document Integrity</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

