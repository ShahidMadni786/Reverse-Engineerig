# Local Academic Similarity Platform
## Offline-First Academic Integrity & Multi-Method Similarity Engine

An independent, local-first academic similarity platform that runs entirely on your local machine without external subscription services, cloud APIs, or third-party plagiarism detection dependencies.

---

## Key Features

### 1. Document Extraction & Preprocessing
- **Supported Formats**: `.pdf`, `.docx`, `.txt`, `.md`.
- **Pre-extraction Validation**: Verifies document integrity, identifies binary masquerades, and detects file corruption.
- **Text Normalization**: Unicode NFKC normalization, whitespace collapsing, and case-folding with character and word offset mapping.
- **Structural Segmentation**: Paragraph segmentation and sentence boundary detection.
- **Dynamic Exclusions**:
  - **Quoted Text Detection**: Recognizes double quotes (`"..."`, `“...”`), blockquotes, and dialogues.
  - **Bibliography / Reference Section Detection**: Identifies academic reference headings (`References`, `Bibliography`, `Works Cited`) to exclude citations from false similarity inflations.
  - **Small Match Filtering**: Configurable word thresholds (e.g., 6–10 words) to eliminate trivial phrase coincidences.

### 2. Multi-Method Similarity Engine
- **Multi-Word Exact Matching**: Sliding-window alignment of exact overlapping phrases.
- **N-Gram Shingling & Inverted Index**: Computes $w$-shingles with 32-bit FNV-1a integer hashing for sub-linear corpus lookup.
- **Jaccard Similarity & Containment Metric**:
  $$J(A, B) = \frac{|A \cap B|}{|A \cup B|}, \quad C(A, B) = \frac{|A \cap B|}{|A|}$$
- **TF-IDF & Vector Space Cosine Similarity**:
  $$\cos(\vec{u}, \vec{v}) = \frac{\sum u_i v_i}{\|\vec{u}\| \|\vec{v}\|}$$
- **Non-Overlapping Union Aggregation**: Calculates true overall similarity percentage without double-counting intersecting matches.

### 3. Local Document Corpus & Incremental Indexing
- Build your own institutional, research, or course comparison repository.
- **Incremental Indexing**: Adding a new document to the corpus indexes only the new document's shingles into SQLite without rebuilding the rest of the database.
- Cascade deletion: Removing a corpus document cleanly updates the inverted index.

### 4. Interactive Report Viewer & Exporting
- **Overall Similarity Badge**: Visual score index color-coded by severity (<15% green, 15–30% amber, >30% red).
- **Interactive Inline Highlighting**: Highlights matched passages color-coded by source document.
- **Source Breakdown**: Shows percentage contribution, matched word count, passage count, Jaccard score, and cosine similarity for each matched source.
- **Dynamic Recalculation**: Toggle quotes and bibliography exclusions on the fly without re-uploading.
- **Stand-Alone HTML & JSON Export**: One-click download of self-contained, printable HTML reports and JSON datasets.

### 5. Local Database & RBAC Security
- **SQLite Engine**: Zero external database server needed; uses Node.js built-in `node:sqlite`.
- **Role-Based Access Control**:
  - `admin`: Full configuration, user management, corpus administration, and submission history.
  - `instructor`: Corpus management, document comparison, and all student reports.
  - `student`: Submit documents and review own reports.
- **Secure Authentication**: Salted `scrypt` password hashing and session tokens.

---

## Quick Start & Installation

### Requirements
- **Node.js**: v22+ (v25 recommended, includes built-in `node:sqlite`)
- Operating System: Windows, macOS, or Linux
- No external paid APIs or subscription keys needed.

### Running the Local Web Application
```bash
# Start the web server on http://localhost:3000
npm run similarity:start

# Or start on a custom port
node src/similarity/cli.mjs start --port 8080
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

**Default Accounts**:
- Admin: `admin` / `admin123`
- Instructor: `professor` / `prof123`
- Student: `student` / `student123`

---

## Command Line Interface (CLI)

The platform provides a CLI for scripting and automated pipelines:

```bash
# 1. View corpus and system statistics
node src/similarity/cli.mjs stats

# 2. Ingest reference documents into local corpus
node src/similarity/cli.mjs ingest path/to/reference_paper.pdf --title "Distributed Raft Consensus" --author "Diego Ongaro"

# 3. Compare a submission against the corpus from the terminal
node src/similarity/cli.mjs compare path/to/student_essay.docx --exclude-bib --exclude-quotes

# 4. View help
node src/similarity/cli.mjs help
```

---

## Running Automated Tests

Run the test suite:
```bash
npm run similarity:test
```
This executes:
1. Text normalization & Unicode NFKC verification.
2. Tokenization and offset preservation.
3. Sentence and paragraph segmentation.
4. Quoted text and bibliography section detection.
5. Plain text extraction and corrupt file handling.
6. FNV-1a shingle generation and hashing.
7. Jaccard similarity and containment calculation.
8. TF-IDF vector space cosine similarity.
9. SQLite schema initialization and persistence.
10. Password hashing with timing-safe verification.
11. User creation and session token lifecycle.
12. Incremental corpus indexing.
13. End-to-end submission comparison with known overlap.
14. Standalone HTML report export generation.
15. Dynamic exclusion toggling.

---

## Architecture & Codebase Layout

```
src/similarity/
├── config/
│   └── similarityConfig.js     # Default ports, paths, thresholds
├── db/
│   ├── database.js             # SQLite DatabaseSync connection & schema
│   ├── userRepository.js       # User & session persistence
│   ├── corpusRepository.js     # Corpus docs & inverted shingle index
│   ├── submissionRepository.js # Submission lifecycle tracking
│   └── reportRepository.js     # Analysis report records
├── extractors/
│   ├── txtExtractor.js         # Plain text & corruption detection
│   ├── docxExtractor.js        # DOCX zip parser & XML text extractor
│   ├── pdfExtractor.js         # PDF stream & operator text extractor
│   └── documentExtractor.js    # Unified router and file validator
├── nlp/
│   ├── normalizer.js           # Tokenization with character offsets
│   ├── segmenter.js            # Paragraph & sentence segmentation
│   └── exclusions.js           # Quote & bibliography detectors
├── engine/
│   ├── shingling.js            # N-gram shingle generator & FNV-1a hash
│   ├── jaccardMatcher.js       # Jaccard & containment calculator
│   ├── tfidfMatcher.js         # TF-IDF vector cosine similarity
│   └── similarityEngine.js     # Orchestrator & overlap union aggregator
├── reporting/
│   └── htmlExporter.js         # Standalone HTML report generator
├── auth/
│   └── passwords.js            # Scrypt password hashing & tokens
├── server/
│   └── httpServer.js           # Native Node HTTP REST API & static server
├── ui/
│   └── public/                 # Single-Page Application (HTML5/CSS3/JS)
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── tests/
│   └── similarityPlatform.test.mjs  # Complete test suite
└── cli.mjs                     # CLI runner (start, ingest, compare, stats)
```

---

## Transparency & Methodological Note

A locally maintained corpus operates independently of commercial plagiarism services. Similarity scores reflect containment and overlap with documents you have authorized and indexed in your local repository.
