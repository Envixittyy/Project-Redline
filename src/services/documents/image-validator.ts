import "server-only";
import sharp from "sharp";

export class ImageValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export type ValidatedImage = {
  mimeType: AllowedImageMimeType;
  base64: string;
  dataUrl: string;
  byteLength: number;
  fileName: string;
  width: number;
  height: number;
};

/**
 * Detects the container signature. Full decoding is still required below.
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
 * - Fully decodes one bounded frame and strips metadata by re-encoding as PNG
 * - Returns only the normalized derivative; it is not cloud-transfer authority
 */
export async function validateImageBuffer(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string,
  declaredMimeType?: string,
): Promise<ValidatedImage> {
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

  const sanitizedFileName = fileName.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
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

  if (declaredMimeType && declaredMimeType !== detectedMime) {
    throw new ImageValidationError(
      "Declared MIME type does not match image contents.",
      "mime_type_mismatch",
    );
  }

  try {
    const decoder = sharp(Buffer.from(bytes), {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      animated: false,
    }).timeout({ seconds: 5 });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height ||
        metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
        (metadata.pages ?? 1) !== 1) {
      throw new ImageValidationError("Image dimensions or frame count exceed the limit.", "image_dimensions_exceeded");
    }
    // Sharp removes EXIF/XMP/IPTC by default. Never use keepMetadata/withMetadata.
    const { data, info } = await decoder.autoOrient().png().toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) {
      throw new ImageValidationError("Normalized image exceeds the byte limit.", "image_too_large");
    }
    const base64 = data.toString("base64");
    return {
      mimeType: "image/png",
      base64,
      dataUrl: `data:image/png;base64,${base64}`,
      byteLength: data.length,
      fileName: sanitizedFileName.replace(/\.[^.]*$/, "") + ".png",
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("Malformed image or image exceeds decoding limits.", "invalid_image");
  }
}

