import "server-only";

export class ImageValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export type ValidatedImage = {
  mimeType: AllowedImageMimeType;
  base64: string;
  dataUrl: string;
  byteLength: number;
  fileName: string;
};

/**
 * Validates magic bytes to ensure file is genuinely a PNG, JPEG, or WEBP image.
 */
function detectImageMimeType(buf: Uint8Array): AllowedImageMimeType | null {
  if (buf.length < 12) return null;

  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG magic: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP magic: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Validates an uploaded image buffer strictly on the server:
 * - Rejects non-PNG/JPEG/WEBP formats
 * - Validates magic bytes (detects spoofed extensions/MIME types)
 * - Enforces max byte size (5MB)
 * - Sanitizes filename
 * - Returns clean base64 and data URL
 */
export function validateImageBuffer(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string,
  declaredMimeType?: string,
): ValidatedImage {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : Buffer.isBuffer(buffer)
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer);

  if (bytes.length === 0) {
    throw new ImageValidationError("Image file is empty.", "empty_image");
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(
      `Image size exceeds maximum limit (${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`,
      "image_too_large",
    );
  }

  const sanitizedFileName = fileName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  if (!sanitizedFileName) {
    throw new ImageValidationError("Invalid file name.", "invalid_filename");
  }

  const detectedMime = detectImageMimeType(bytes);
  if (!detectedMime) {
    throw new ImageValidationError(
      "Invalid or unsupported image format. Please upload a valid PNG, JPEG, or WEBP screenshot.",
      "unsupported_image_format",
    );
  }

  if (declaredMimeType && declaredMimeType !== detectedMime && !declaredMimeType.startsWith("image/")) {
    throw new ImageValidationError(
      "Declared MIME type does not match image contents.",
      "mime_type_mismatch",
    );
  }

  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${detectedMime};base64,${base64}`;

  return {
    mimeType: detectedMime,
    base64,
    dataUrl,
    byteLength: bytes.length,
    fileName: sanitizedFileName,
  };
}
