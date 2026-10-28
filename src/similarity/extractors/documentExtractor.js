import { createHash } from "node:crypto";
import { extname } from "node:path";
import { extractTxt, CorruptDocumentError, UnsupportedDocumentError } from "./txtExtractor.js";
import { extractDocx } from "./docxExtractor.js";
import { extractPdf } from "./pdfExtractor.js";

export function extractDocument(fileName, buffer) {
  if (buffer.length === 0) {
    throw new CorruptDocumentError(`Document "${fileName}" is empty (0 bytes).`);
  }

  const ext = extname(fileName).toLowerCase().replace(/^\./, "");
  let extracted;

  switch (ext) {
    case "txt":
    case "md":
    case "text":
      extracted = extractTxt(buffer);
      break;
    case "docx":
      extracted = extractDocx(buffer);
      break;
    case "pdf":
      extracted = extractPdf(buffer);
      break;
    default:
      throw new UnsupportedDocumentError(
        `Unsupported document format ".${ext}". Supported formats are: .txt, .docx, .pdf`,
      );
  }

  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const rawText = extracted.text;
  if (!rawText || rawText.trim().length === 0) {
    const hint = ext === "pdf"
      ? "This PDF may be scanned or use an unsupported text encoding. Run OCR or export it as a searchable PDF, then try again."
      : "Check that the document contains readable text.";
    throw new CorruptDocumentError(`No readable text could be extracted from "${fileName}". ${hint}`);
  }
  const wordCount = (rawText.match(/\S+/g) ?? []).length;
  const characterCount = rawText.length;

  return {
    fileName,
    fileType: ext === "txt" || ext === "md" || ext === "text" ? "txt" : ext,
    fileHash,
    byteSize: buffer.length,
    rawText,
    wordCount,
    characterCount,
    metadata: extracted.metadata,
    ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
  };
}

