import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class IntegrationCredentialError extends Error {}

function credentialKey(): Buffer {
  const encoded = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new IntegrationCredentialError("Integration credential encryption is not configured.");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) throw new IntegrationCredentialError("Integration credential encryption is misconfigured.");
  return value;
}

export function encryptCredential(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCredential(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new IntegrationCredentialError("Stored integration credentials are invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new IntegrationCredentialError("Stored integration credentials could not be decrypted.");
  }
}

export function credentialHint(url: string): string {
  return new URL(url).hostname;
}
