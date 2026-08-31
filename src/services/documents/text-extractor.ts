import "server-only";

export class DocumentExtractionError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_DOCUMENT_CHARS = 25000;
const MAX_TEXT_BYTES = 32768;

/** Preserve the complete reviewed source; never silently discard content. */
export function normalizeExtractedText(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    throw new DocumentExtractionError("binary_not_supported", "binary_not_supported");
  }
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > MAX_DOCUMENT_CHARS || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new DocumentExtractionError("document_too_large_or_empty", "document_too_large_or_empty");
  }
  return text;
}

/** PDF/DOCX stay disabled until isolated, resource-bounded extraction is reviewed. */
export async function extractTextFromBuffer(
  buffer: Uint8Array | ArrayBuffer,
  fileName: string,
  mimeType = "text/plain",
) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!/\.(txt|md|csv|ics)$/i.test(fileName) || fileName.length > 200 ||
      !["", "application/octet-stream", "text/plain", "text/markdown", "text/csv", "text/calendar"].includes(mimeType)) {
    throw new DocumentExtractionError("unsupported_format: use TXT, MD, CSV or ICS; PDF/DOCX extraction is unavailable.", "unsupported_format");
  }
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentExtractionError("invalid_file_size", "invalid_file_size");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentExtractionError("invalid_utf8", "invalid_utf8");
  }
  if (decoded.startsWith("%PDF-")) {
    throw new DocumentExtractionError("unsupported_format", "unsupported_format");
  }
  const text = normalizeExtractedText(decoded);
  return {
    fileName: fileName.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, ""),
    mimeType,
    text,
    charCount: text.length,
  };
}
