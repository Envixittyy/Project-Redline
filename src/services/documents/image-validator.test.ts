import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import sharp from "sharp";
import { validateImageBuffer, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from "./image-validator";

async function fixture(format: "png" | "jpeg" | "webp", width = 2, height = 2) {
  return sharp({ create: { width, height, channels: 3, background: "white" } }).toFormat(format).toBuffer();
}

describe("bounded image decoding", () => {
  it.each(["png", "jpeg", "webp"] as const)("fully decodes %s and returns a metadata-free PNG derivative", async format => {
    const source = await fixture(format);
    const result = await validateImageBuffer(source, `image.${format}`, `image/${format}`);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.byteLength).toBe(Buffer.from(result.base64, "base64").length);
    const decoded = await sharp(Buffer.from(result.base64, "base64")).metadata();
    expect(decoded.format).toBe("png");
    expect(decoded.exif).toBeUndefined();
  });
  it.each(["image/jpeg", "image/webp", "image/svg+xml", "text/plain"])("rejects PNG with spoofed MIME %s", async mime => {
    await expect(validateImageBuffer(await fixture("png"), "image.png", mime)).rejects.toMatchObject({ code: "mime_type_mismatch" });
  });
  it.each([
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13],
    [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1],
    [82, 73, 70, 70, 36, 0, 0, 0, 87, 69, 66, 80],
  ])("rejects signature-only malformed input %j", async (...signature) => {
    await expect(validateImageBuffer(Buffer.from(signature), "image.png")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("rejects empty, oversized and non-image input", async () => {
    for (const input of [Buffer.alloc(0), Buffer.alloc(MAX_IMAGE_BYTES + 1), Buffer.from("https://127.0.0.1/private")]) {
      await expect(validateImageBuffer(input, "image.png")).rejects.toThrow();
    }
  });
  it("rejects oversized dimensions and compressed pixel bombs", async () => {
    await expect(validateImageBuffer(await fixture("png", MAX_IMAGE_DIMENSION + 1, 1), "wide.png")).rejects.toThrow();
    await expect(validateImageBuffer(await fixture("png", 5000, 5000), "pixels.png")).rejects.toThrow();
  });
  it("rejects animated WebP rather than silently selecting its first frame", async () => {
    const source = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(source).metadata()).pages).toBe(2);
    await expect(validateImageBuffer(source, "animated.webp", "image/webp")).rejects.toMatchObject({ code: "image_dimensions_exceeded" });
  });
  it("strips EXIF and path components rather than retaining source metadata", async () => {
    const source = await sharp(await fixture("jpeg")).withMetadata().jpeg().toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await validateImageBuffer(source, "../../private/image.jpg", "image/jpeg");
    expect(result.fileName).toBe("image.png");
    expect((await sharp(Buffer.from(result.base64, "base64")).metadata()).exif).toBeUndefined();
  });
  it("uses normalized pixel output for digest semantics, so metadata-only differences converge", async () => {
    const pixels = await fixture("png");
    const plain = await sharp(pixels).png().toBuffer();
    const tagged = await sharp(pixels).withExif({ IFD0: { Copyright: "private source metadata" } }).png().toBuffer();
    expect(tagged.equals(plain)).toBe(false);
    const normalizedPlain = await validateImageBuffer(plain, "plain.png", "image/png");
    const normalizedTagged = await validateImageBuffer(tagged, "tagged.png", "image/png");
    const hash = (base64: string) => createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
    expect(hash(normalizedTagged.base64)).toBe(hash(normalizedPlain.base64));
  });
  it("rejects a truncated image after its valid header", async () => {
    const source = await fixture("jpeg", 100, 100);
    await expect(validateImageBuffer(source.subarray(0, source.length - 30), "truncated.jpg")).rejects.toThrow();
  });
});
