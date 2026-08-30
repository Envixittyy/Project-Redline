/** Pure URL policy shared with the browser; no DNS, secrets, or Node imports. */
export const DEFAULT_RUNTIME_ENDPOINTS = {
  ollama: "http://127.0.0.1:11434/",
  llamacpp: "http://127.0.0.1:8080/",
  openai_compatible: "http://127.0.0.1:1234/v1",
} as const;

export function isLoopbackHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

export function validateLoopbackUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 256)
    throw new Error("Invalid local endpoint.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid local endpoint.");
  }
  if (
    url.protocol !== "http:" ||
    !isLoopbackHost(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new Error("Only a loopback HTTP root or /v1 endpoint is permitted.");
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}

export function validateCompanionUrl(value: string): URL {
  const url = validateLoopbackUrl(value);
  if (
    url.pathname !== "/" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "41400"
  ) {
    throw new Error(
      "The browser companion endpoint must be http://127.0.0.1:41400.",
    );
  }
  return url;
}

export function isModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value)
  );
}
