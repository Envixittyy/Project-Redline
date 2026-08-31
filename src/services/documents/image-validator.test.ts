import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  validateImageBuffer,
  MAX_IMAGE_BYTES,
  ImageValidationError,
} from "./image-validator";

function createFakePng(): Buffer {
  // Minimal PNG signature: 89 50 4E 47 0D 0A 1A 0A followed by 4 dummy bytes
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
}

function createFakeJpeg(): Buffer {
  // Minimal JPEG signature: FF D8 FF followed by bytes
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
}

function createFakeWebp(): Buffer {
  // Minimal WEBP signature: RIFF....WEBP
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

describe("Image Validator (validateImageBuffer)", () => {
  it("accepts and extracts valid PNG image", () => {
    const png = createFakePng();
    const res = validateImageBuffer(png, "schedule.png", "image/png");

    expect(res.mimeType).toBe("image/png");
    expect(res.fileName).toBe("schedule.png");
    expect(res.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(res.byteLength).toBe(png.length);
  });

  it("accepts and extracts valid JPEG image", () => {
    const jpeg = createFakeJpeg();
    const res = validateImageBuffer(jpeg, "blackboard.jpg", "image/jpeg");

    expect(res.mimeType).toBe("image/jpeg");
    expect(res.fileName).toBe("blackboard.jpg");
    expect(res.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("accepts and extracts valid WEBP image", () => {
    const webp = createFakeWebp();
    const res = validateImageBuffer(webp, "calendar.webp", "image/webp");

    expect(res.mimeType).toBe("image/webp");
    expect(res.fileName).toBe("calendar.webp");
    expect(res.dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("rejects empty image buffer", () => {
    expect(() => validateImageBuffer(Buffer.alloc(0), "empty.png")).toThrowError(
      ImageValidationError,
    );
  });

  it("rejects images exceeding MAX_IMAGE_BYTES", () => {
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(() => validateImageBuffer(huge, "huge.png")).toThrowError(
      "Image size exceeds maximum limit",
    );
  });

  it("rejects spoofed extension with non-image bytes", () => {
    const fake = Buffer.from("Hello, this is just plain text masquerading as PNG.");
    expect(() => validateImageBuffer(fake, "fake.png", "image/png")).toThrowError(
      "Invalid or unsupported image format",
    );
  });

  it("sanitizes control characters in filename", () => {
    const png = createFakePng();
    const res = validateImageBuffer(png, "sched\u0000ule\n.png");
    expect(res.fileName).toBe("schedule.png");
  });
});

