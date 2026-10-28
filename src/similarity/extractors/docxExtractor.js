import { inflateRawSync } from "node:zlib";
import { CorruptDocumentError } from "./txtExtractor.js";

function parseZipEntries(buffer) {
  const entries = new Map();

  // Find End of Central Directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1;
  const searchLimit = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchLimit; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new CorruptDocumentError("Invalid DOCX file: End of Central Directory signature not found.");
  }

  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  let currentOffset = centralDirOffset;
  const centralDirEnd = centralDirOffset + centralDirSize;

  while (currentOffset < centralDirEnd && currentOffset + 46 <= buffer.length) {
    const signature = buffer.readUInt32LE(currentOffset);
    if (signature !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(currentOffset + 10);
    const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(currentOffset + 24);
    const fileNameLen = buffer.readUInt16LE(currentOffset + 28);
    const extraFieldLen = buffer.readUInt16LE(currentOffset + 30);
    const fileCommentLen = buffer.readUInt16LE(currentOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(currentOffset + 42);

    const fileName = buffer.toString("utf8", currentOffset + 46, currentOffset + 46 + fileNameLen);

    if (localHeaderOffset + 30 <= buffer.length) {
      const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      entries.set(fileName, {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        dataOffset,
      });
    }

    currentOffset += 46 + fileNameLen + extraFieldLen + fileCommentLen;
  }

  return entries;
}

function extractZipEntry(buffer, entry) {
  const slice = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return slice;
  } else if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(slice);
    } catch (err) {
      throw new CorruptDocumentError(`Failed to decompress ${entry.fileName}`, err);
    }
  } else {
    throw new CorruptDocumentError(`Unsupported compression method ${entry.compressionMethod} for ${entry.fileName}`);
  }
}

function parseXmlText(xml) {
  const withParagraphs = xml.replace(/<\/w:p>/gi, "\n\n");
  const withBreaks = withParagraphs.replace(/<w:br[^>]*\/>|<w:cr[^>]*\/>/gi, "\n");

  const regex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi;
  let match;

  const paragraphBlocks = withBreaks.split("\n\n");
  const cleanParagraphs = [];

  for (const block of paragraphBlocks) {
    let pText = "";
    while ((match = regex.exec(block)) !== null) {
      const rawText = match[1] ?? "";
      const decoded = rawText
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      pText += decoded;
    }
    pText = pText.trim();
    if (pText.length > 0) {
      cleanParagraphs.push(pText);
    }
  }

  return cleanParagraphs.join("\n\n");
}

export function extractDocx(buffer) {
  if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new CorruptDocumentError("File is not a valid DOCX archive (missing ZIP signature).");
  }

  const entries = parseZipEntries(buffer);
  const docEntry = entries.get("word/document.xml");
  if (!docEntry) {
    throw new CorruptDocumentError("DOCX archive is missing word/document.xml");
  }

  const docXmlBuffer = extractZipEntry(buffer, docEntry);
  const xmlContent = docXmlBuffer.toString("utf8");
  const extractedText = parseXmlText(xmlContent);

  const metadata = {
    format: "docx",
    byteSize: buffer.length,
  };

  return {
    text: extractedText,
    metadata,
  };
}
