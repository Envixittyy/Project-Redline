import "server-only";

import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import {
  isPublicAddress,
  normalizeFeedHostname,
  validateFeedUrl,
} from "./safe-url";

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const TOTAL_TIMEOUT_MS = 10_000;

type BlackboardResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

type ResolveAddresses = (url: URL) => Promise<LookupAddress[]>;
type RequestOnce = (url: URL, addresses: LookupAddress[]) => Promise<BlackboardResponse>;

export type BlackboardFetchDependencies = {
  resolveAddresses?: ResolveAddresses;
  requestOnce?: RequestOnce;
  allowedHosts?: readonly string[];
};

export class BlackboardFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BlackboardFetchError";
  }
}

function safeLookupError(code: string, message: string): BlackboardFetchError {
  return new BlackboardFetchError(code, message);
}

function normalizedFamily(family: number | "IPv4" | "IPv6" | undefined): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

/**
 * Pin an HTTPS connection to the addresses that were already classified.
 * Node 22+ may request `all: true`; that callback must receive address objects,
 * not the legacy single address/family tuple.
 */
export function createPinnedLookup(
  expectedHostname: string,
  addresses: readonly LookupAddress[],
): LookupFunction {
  const expected = normalizeFeedHostname(expectedHostname);

  return (hostname, options, callback) => {
    if (normalizeFeedHostname(hostname) !== expected) {
      callback(
        safeLookupError("unsafe_dns", "The feed connection changed hosts unexpectedly."),
        "",
        0,
      );
      return;
    }

    const requestedFamily = normalizedFamily(options.family);
    const matching = addresses.filter(
      (answer) => requestedFamily === 0 || answer.family === requestedFamily,
    );

    if (matching.length === 0) {
      callback(
        safeLookupError("dns_failed", "The feed host has no usable public address."),
        "",
        0,
      );
      return;
    }

    if (options.all) {
      callback(
        null,
        matching.map(({ address, family }) => ({ address, family })),
      );
      return;
    }

    callback(null, matching[0].address, matching[0].family);
  };
}

async function lookupAll(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

/** Resolve once, validate every answer, and return only the pinned public set. */
export async function resolvePublicAddresses(
  url: URL,
  resolveHostname: (hostname: string) => Promise<LookupAddress[]> = lookupAll,
): Promise<LookupAddress[]> {
  const hostname = normalizeFeedHostname(url.hostname);
  const literalFamily = isIP(hostname);

  let answers: LookupAddress[];
  try {
    answers = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await resolveHostname(hostname);
  } catch {
    throw new BlackboardFetchError("dns_failed", "The feed host could not be resolved.");
  }

  if (
    answers.length === 0 ||
    answers.some(
      (answer) =>
        (answer.family !== 4 && answer.family !== 6) ||
        isIP(answer.address) !== answer.family ||
        !isPublicAddress(answer.address),
    )
  ) {
    throw new BlackboardFetchError(
      "unsafe_dns",
      "The feed host resolves to a private, malformed, or reserved address.",
    );
  }

  const unique = new Map(
    answers.map(({ address, family }) => [
      `${family}:${address.toLowerCase()}`,
      { address, family },
    ]),
  );

  return [...unique.values()];
}

function networkFailure(error: unknown): BlackboardFetchError {
  if (error instanceof BlackboardFetchError) return error;
  return new BlackboardFetchError("network_error", "Blackboard could not be reached securely.");
}

async function requestOnce(url: URL, addresses: LookupAddress[]): Promise<BlackboardResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout: { timer?: NodeJS.Timeout } = {};
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout.timer) clearTimeout(timeout.timer);
      callback();
    };
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/calendar, application/ics;q=0.9",
          "User-Agent": "Forward-Blackboard-Sync/1",
        },
        lookup: createPinnedLookup(url.hostname, addresses),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
          req.destroy(
            new BlackboardFetchError(
              "response_too_large",
              "The Blackboard feed exceeds the size limit.",
            ),
          );
          return;
        }

        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(
              new BlackboardFetchError(
                "response_too_large",
                "The Blackboard feed exceeds the size limit.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("aborted", () =>
          finish(() => reject(new BlackboardFetchError("partial_response", "Blackboard returned an incomplete calendar."))),
        );
        response.on("end", () => {
          if (!response.complete) {
            finish(() => reject(new BlackboardFetchError("partial_response", "Blackboard returned an incomplete calendar.")));
            return;
          }
          finish(() => resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }));
        });
      },
    );

    timeout.timer = setTimeout(() =>
      req.destroy(new BlackboardFetchError("timeout", "Blackboard did not respond in time.")),
      TOTAL_TIMEOUT_MS,
    );
    req.setTimeout(TOTAL_TIMEOUT_MS, () =>
      req.destroy(new BlackboardFetchError("timeout", "Blackboard did not respond in time.")),
    );
    req.on("error", (error) => finish(() => reject(networkFailure(error))));
    req.end();
  });
}

export async function fetchBlackboardCalendar(
  value: string,
  dependencies: BlackboardFetchDependencies = {},
): Promise<string> {
  const resolveAddresses = dependencies.resolveAddresses ?? resolvePublicAddresses;
  const sendRequest = dependencies.requestOnce ?? requestOnce;
  const initial = validateFeedUrl(value, dependencies.allowedHosts);
  const allowedHosts = dependencies.allowedHosts ?? [normalizeFeedHostname(initial.hostname)];
  let url = validateFeedUrl(initial.toString(), allowedHosts);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await resolveAddresses(url);
    const response = await sendRequest(url, addresses);

    if (response.status >= 300 && response.status < 400) {
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0]
        : response.headers.location;

      if (!location || redirect === MAX_REDIRECTS) {
        throw new BlackboardFetchError("redirect", "The Blackboard feed redirected unsafely.");
      }

      url = validateFeedUrl(new URL(location, url).toString(), allowedHosts);
      continue;
    }

    if (response.status !== 200) {
      throw new BlackboardFetchError(
        "http_status",
        "Blackboard returned an unsuccessful response.",
      );
    }

    const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/calendar") &&
      !contentType.includes("application/ics") &&
      !contentType.includes("text/plain")
    ) {
      throw new BlackboardFetchError(
        "content_type",
        "Blackboard returned an unexpected content type.",
      );
    }

    if (!response.body.includes("BEGIN:VCALENDAR")) {
      throw new BlackboardFetchError(
        "invalid_calendar",
        "Blackboard returned an invalid calendar.",
      );
    }

    return response.body;
  }

  throw new BlackboardFetchError("redirect", "The Blackboard feed redirected too many times.");
}
