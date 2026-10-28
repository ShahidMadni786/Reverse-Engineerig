import { inflateSync } from "node:zlib";
import { CorruptDocumentError } from "./txtExtractor.js";

function decodePdfLiteralString(str) {
  let result = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\\" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "n") {
        result += "\n";
        i += 2;
      } else if (next === "r") {
        result += "\r";
        i += 2;
      } else if (next === "t") {
        result += "\t";
        i += 2;
      } else if (next === "b") {
        result += "\b";
        i += 2;
      } else if (next === "f") {
        result += "\f";
        i += 2;
      } else if (next === "(" || next === ")" || next === "\\") {
        result += next;
        i += 2;
      } else if (/[0-7]/.test(next ?? "")) {
        let octal = next ?? "";
        let j = i + 2;
        while (j < str.length && j < i + 4 && /[0-7]/.test(str[j] ?? "")) {
          octal += str[j];
          j++;
        }
        result += String.fromCharCode(parseInt(octal, 8));
        i = j;
      } else {
        result += next;
        i += 2;
      }
    } else {
      result += str[i];
      i++;
    }
  }
  return result;
}

function decodeHexString(hex) {
  let clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) {
    clean += "0";
  }
  let result = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.substring(i, i + 2), 16);
    if (!isNaN(code)) {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

function extractTextFromStreamContent(streamText) {
  const textPieces = [];
  const btEtRegex = /BT[\s\S]*?ET/g;
  let blockMatch;

  while ((blockMatch = btEtRegex.exec(streamText)) !== null) {
    const block = blockMatch[0];

    const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const arrayContent = tjMatch[1] ?? "";
      const stringTokenRegex = /\((?:[^\\()]|\\.)*\)|<[0-9a-fA-F\s]+>/g;
      let tokenMatch;
      let combined = "";
      while ((tokenMatch = stringTokenRegex.exec(arrayContent)) !== null) {
        const token = tokenMatch[0];
        if (token.startsWith("(") && token.endsWith(")")) {
          combined += decodePdfLiteralString(token.slice(1, -1));
        } else if (token.startsWith("<") && token.endsWith(">")) {
          combined += decodeHexString(token.slice(1, -1));
        }
      }
      if (combined.trim().length > 0) {
        textPieces.push(combined);
      }
    }

    const singleTjRegex = /(\((?:[^\\()]|\\.)*\)|<[0-9a-fA-F\s]+>)\s*Tj/g;
    let singleMatch;
    while ((singleMatch = singleTjRegex.exec(block)) !== null) {
      const token = singleMatch[1] ?? "";
      let decoded = "";
      if (token.startsWith("(") && token.endsWith(")")) {
        decoded = decodePdfLiteralString(token.slice(1, -1));
      } else if (token.startsWith("<") && token.endsWith(">")) {
        decoded = decodeHexString(token.slice(1, -1));
      }
      if (decoded.trim().length > 0) {
        textPieces.push(decoded);
      }
    }

    if (/T\*|'|"/.test(block)) {
      textPieces.push("\n");
    }
  }

  if (textPieces.length === 0) {
    const fallbackRegex = /\((?:[^\\()]|\\.)*\)/g;
    let m;
    while ((m = fallbackRegex.exec(streamText)) !== null) {
      const t = decodePdfLiteralString(m[0].slice(1, -1)).trim();
      if (t.length > 3 && /[a-zA-Z0-9]/.test(t)) {
        textPieces.push(t);
      }
    }
  }

  return textPieces.join(" ").replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ");
}

export function extractPdf(buffer) {
  const header = buffer.subarray(0, 1024).toString("latin1");
  if (!header.includes("%PDF-")) {
    throw new CorruptDocumentError("File does not start with a valid PDF header (%PDF-).");
  }

  const fullAscii = buffer.toString("latin1");
  if (fullAscii.includes("/Encrypt") && fullAscii.includes("/Filter /Standard")) {
    throw new CorruptDocumentError("The PDF document is password-protected or encrypted.");
  }

  const pageMatches = fullAscii.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  const metadata = {
    format: "pdf",
    byteSize: buffer.length,
    pageCount,
  };

  const extractedSections = [];
  let streamIndex = 0;

  while ((streamIndex = buffer.indexOf("stream", streamIndex)) !== -1) {
    let dataStart = streamIndex + 6;
    if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buffer[dataStart] === 0x0a) {
      dataStart += 1;
    }

    const streamEnd = buffer.indexOf("endstream", dataStart);
    if (streamEnd === -1) {
      break;
    }

    const dictStart = Math.max(0, streamIndex - 2048);
    const dictChunk = buffer.subarray(dictStart, streamIndex).toString("latin1");
    const isFlate = dictChunk.includes("/FlateDecode");

    const rawStreamData = buffer.subarray(dataStart, streamEnd);

    if (isFlate) {
      try {
        const decompressed = inflateSync(rawStreamData);
        const text = extractTextFromStreamContent(decompressed.toString("latin1"));
        if (text.trim().length > 0) {
          extractedSections.push(text);
        }
      } catch {
        // Skip non-text stream
      }
    } else {
      const text = extractTextFromStreamContent(rawStreamData.toString("latin1"));
      if (text.trim().length > 0) {
        extractedSections.push(text);
      }
    }

    streamIndex = streamEnd + 9;
  }

  let fullText = extractedSections.join("\n\n").trim();
  fullText = fullText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");

  return {
    text: fullText,
    metadata,
    pageCount,
  };
}
