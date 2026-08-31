import "server-only";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export class DocumentExtractionError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

export type ExtractedDocument = {
  fileName: string;
  mimeType: string;
  charCount: number;
  text: string;
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_CHARS = 25000;

/**
 * Normalizes text, sanitizes control characters, and truncates safely within MAX_DOCUMENT_CHARS.
 */
export function normalizeExtractedText(raw: string): string {
  // Replace null bytes and non-printable control characters except newline and tab
  const cleaned = raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (cleaned.length > MAX_DOCUMENT_CHARS) {
    return cleaned.slice(0, MAX_DOCUMENT_CHARS);
  }

  return cleaned;
}

function isPdf(fileName: string, mimeType: string, buf: Buffer): boolean {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf") || mimeType === "application/pdf") {
    return true;
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    return true;
  }
  return false;
}

function isDocx(fileName: string, mimeType: string, buf: Buffer): boolean {
  const lowerName = fileName.toLowerCase();
  if (
    lowerName.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }
  // Check for PK zip header if filename also hints at docx
  if (
    lowerName.endsWith(".docx") &&
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    return true;
  }
  return false;
}

async function extractPdfText(buf: Buffer, fileName: string): Promise<ExtractedDocument> {
  let parsedText = "";
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buf });
    const textResult = await parser.getText();
    parsedText = textResult?.text || "";
  } catch (err) {
    if (err instanceof DocumentExtractionError) {
      throw err;
    }
    throw new DocumentExtractionError(
      "Failed to parse PDF document. The file may be corrupt, password-protected, or invalid.",
      "pdf_parse_failed",
    );
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore destroy error
      }
    }
  }

  const cleanedContent = parsedText
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .replace(/--\s*Page\s+\d+\s*--/gi, "")
    .trim();

  if (!cleanedContent) {
    throw new DocumentExtractionError(
      "This PDF contains no extractable text. Scanned or image-only PDFs are not supported yet.",
      "scanned_pdf_unsupported",
    );
  }

  const normalized = normalizeExtractedText(parsedText);
  if (!normalized) {
    throw new DocumentExtractionError(
      "This PDF contains no extractable text. Scanned or image-only PDFs are not supported yet.",
      "scanned_pdf_unsupported",
    );
  }

  return {
    fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, ""),
    mimeType: "application/pdf",
    charCount: normalized.length,
    text: normalized,
  };
}

async function extractDocxText(buf: Buffer, fileName: string): Promise<ExtractedDocument> {
  let parsedText = "";
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    parsedText = result?.value || "";
  } catch {
    throw new DocumentExtractionError(
      "Failed to parse Word (.docx) document. The file may be corrupt or invalid.",
      "docx_parse_failed",
    );
  }

  const normalized = normalizeExtractedText(parsedText);
  if (!normalized) {
    throw new DocumentExtractionError(
      "This Word (.docx) document contains no readable text.",
      "docx_no_text",
    );
  }

  return {
    fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, ""),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    charCount: normalized.length,
    text: normalized,
  };
}

function extractPlainText(
  buf: Buffer,
  fileName: string,
  mimeType: string,
): ExtractedDocument {
  // Check for common non-text binary signatures
  const probeLength = Math.min(buf.length, 512);
  let nullByteCount = 0;
  for (let i = 0; i < probeLength; i++) {
    if (buf[i] === 0) nullByteCount++;
  }

  if (nullByteCount > probeLength * 0.1) {
    throw new DocumentExtractionError(
      "Binary or non-text document format detected. Please provide a supported text, PDF, or Word document.",
      "binary_not_supported",
    );
  }

  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (err) {
    throw new DocumentExtractionError(
      `Failed to decode text: ${err instanceof Error ? err.message : String(err)}`,
      "decode_failed",
    );
  }

  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    throw new DocumentExtractionError(
      "No readable text could be extracted from this document.",
      "no_text_found",
    );
  }

  return {
    fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, ""),
    mimeType,
    charCount: normalized.length,
    text: normalized,
  };
}

/**
 * Extracts and bounds plain text from supported course documents:
 * - PDF (.pdf, text-readable, no OCR)
 * - Word Document (.docx)
 * - Plain text (.txt)
 * - Markdown (.md)
 * - CSV (.csv)
 * - iCalendar (.ics)
 */
export async function extractTextFromBuffer(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string,
  mimeType = "text/plain",
): Promise<ExtractedDocument> {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));

  if (buf.length === 0) {
    throw new DocumentExtractionError("The provided file is empty.", "empty_file");
  }

  if (buf.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentExtractionError("File exceeds maximum allowed size.", "file_too_large");
  }

  if (fileName.length > 200) {
    throw new DocumentExtractionError("File name is too long.", "invalid_filename");
  }

  if (isPdf(fileName, mimeType, buf)) {
    return extractPdfText(buf, fileName);
  }

  if (isDocx(fileName, mimeType, buf)) {
    return extractDocxText(buf, fileName);
  }

  if (!/\.(txt|md|csv|ics)$/i.test(fileName) && !mimeType.startsWith("text/")) {
    throw new DocumentExtractionError("Unsupported document format.", "unsupported_format");
  }

  return extractPlainText(buf, fileName, mimeType);
}
