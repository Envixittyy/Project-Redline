import { BlockList, isIP } from "node:net";

export class BlackboardUrlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BlackboardUrlError";
  }
}

const nonPublicAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv6");
}

/**
 * URL.hostname retains IPv6 brackets and a fully-qualified hostname may retain
 * its trailing dot. DNS and IP validation need the canonical host value.
 */
export function normalizeFeedHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

/** Fail closed for malformed, private, local, multicast, and reserved addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicAddresses.check(address, "ipv4");
  if (family === 6) return !nonPublicAddresses.check(address, "ipv6");
  return false;
}

export function normalizeBlackboardSubscriptionUrl(value: string): string {
  const trimmed = value.trim();
  return /^webcal:\/\//i.test(trimmed)
    ? `https://${trimmed.slice(trimmed.indexOf("://") + 3)}`
    : trimmed;
}

export function validateFeedUrl(value: string, allowedHosts?: readonly string[]): URL {
  let url: URL;

  try {
    url = new URL(normalizeBlackboardSubscriptionUrl(value));
  } catch {
    throw new BlackboardUrlError("invalid_url", "Enter a valid Blackboard calendar URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new BlackboardUrlError(
      "unsafe_url",
      "The Blackboard feed must use standard HTTPS.",
    );
  }

  const hostname = normalizeFeedHostname(url.hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (isIP(hostname) !== 0 && !isPublicAddress(hostname))
  ) {
    throw new BlackboardUrlError("unsafe_host", "That feed host is not allowed.");
  }

  if (
    allowedHosts &&
    !allowedHosts.map(normalizeFeedHostname).includes(hostname)
  ) {
    throw new BlackboardUrlError(
      "untrusted_host",
      "That host is not configured as a trusted Blackboard host.",
    );
  }

  return url;
}
