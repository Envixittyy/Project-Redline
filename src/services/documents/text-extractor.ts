import "server-only";

export class DocumentExtractionError extends Error {}
export const MAX_DOCUMENT_BYTES = 256 * 1024;

/** Uploaded bytes are untrusted. Only bounded UTF-8 text formats are supported. */
export function extractTextFromBuffer(
  buffer: Uint8Array | ArrayBuffer,
  fileName: string,
) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!/\.(txt|md|csv|ics)$/i.test(fileName) || fileName.length > 200)
    throw new DocumentExtractionError("unsupported_format");
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES)
    throw new DocumentExtractionError("invalid_file_size");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentExtractionError("invalid_utf8");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw new DocumentExtractionError("binary_not_supported");
  text = text.replace(/\r\n?/g, "\n").trim();
  if (
    !text ||
    text.length > 25000 ||
    new TextEncoder().encode(text).length > 32768
  )
    throw new DocumentExtractionError("document_too_large_or_empty");
  return {
    fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, ""),
    text,
    charCount: text.length,
  };
}
