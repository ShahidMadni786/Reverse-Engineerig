export class CorruptDocumentError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = "CorruptDocumentError";
    this.originalError = originalError;
  }
}

export class UnsupportedDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

export function extractTxt(buffer) {
  if (buffer.length === 0) {
    return { text: "", metadata: { format: "txt", byteSize: 0 } };
  }

  // Check for excessive null bytes which indicate binary data
  let nullCount = 0;
  const sampleLength = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0) nullCount++;
  }
  if (nullCount > sampleLength * 0.1) {
    throw new CorruptDocumentError("The text file appears to contain binary or corrupted data.");
  }

  // Detect UTF-16 BOM or decode UTF-8
  let text = "";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    text = swapped.toString("utf16le");
  } else if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    text = buffer.subarray(3).toString("utf8");
  } else {
    text = buffer.toString("utf8");
  }

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return {
    text,
    metadata: {
      format: "txt",
      byteSize: buffer.length,
    },
  };
}

