import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BlackboardFetchError,
  createPinnedLookup,
  fetchBlackboardCalendar,
  resolvePublicAddresses,
} from "./safe-fetch";
import {
  BlackboardUrlError,
  isPublicAddress,
  normalizeFeedHostname,
  normalizeBlackboardSubscriptionUrl,
  validateFeedUrl,
} from "./safe-url";

const PUBLIC_V4: LookupAddress = { address: "8.8.8.8", family: 4 };
const PUBLIC_V6: LookupAddress = { address: "2606:4700:4700::1111", family: 6 };
const CALENDAR = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";

function callLookup(lookup: LookupFunction, options: LookupOptions) {
  return new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("learn.example.edu", options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

describe("Blackboard public-address classification", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:808:808",
  ])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
    "not-an-ip",
  ])("rejects private, reserved, or malformed address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("normalizes IPv6 brackets and fully-qualified hostname dots", () => {
    expect(normalizeFeedHostname("[2606:4700:4700::1111]")).toBe(
      "2606:4700:4700::1111",
    );
    expect(normalizeFeedHostname("Learn.Example.EDU.")).toBe("learn.example.edu");
  });

  it("rejects localhost and private IPv6 literals before DNS", () => {
    expect(() => validateFeedUrl("https://localhost./calendar.ics")).toThrow(
      BlackboardUrlError,
    );
    expect(() => validateFeedUrl("https://sync.localhost/calendar.ics")).toThrow(
      BlackboardUrlError,
    );
    expect(() => validateFeedUrl("https://[::1]/calendar.ics")).toThrow(
      BlackboardUrlError,
    );
    expect(() => validateFeedUrl("https://[::ffff:127.0.0.1]/calendar.ics")).toThrow(
      BlackboardUrlError,
    );
  });

  it("normalizes webcal subscriptions to HTTPS and enforces an exact host allowlist", () => {
    expect(normalizeBlackboardSubscriptionUrl("webcal://learn.example.edu/feed")).toBe(
      "https://learn.example.edu/feed",
    );
    expect(
      validateFeedUrl("webcal://learn.example.edu/feed", ["learn.example.edu"]).protocol,
    ).toBe("https:");
    expect(() =>
      validateFeedUrl("https://other.example.edu/feed", ["learn.example.edu"]),
    ).toThrow(BlackboardUrlError);
  });
});

describe("Blackboard DNS validation and pinning", () => {
  it("accepts public IPv4, public IPv6, and multiple public DNS answers", async () => {
    await expect(
      resolvePublicAddresses(new URL("https://learn.example.edu/feed"), async () => [
        PUBLIC_V4,
        PUBLIC_V6,
        PUBLIC_V4,
      ]),
    ).resolves.toEqual([PUBLIC_V4, PUBLIC_V6]);
  });

  it("rejects the entire DNS set if any answer is private", async () => {
    await expect(
      resolvePublicAddresses(new URL("https://learn.example.edu/feed"), async () => [
        PUBLIC_V4,
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "unsafe_dns" });
  });

  it("rejects malformed DNS answer objects", async () => {
    await expect(
      resolvePublicAddresses(new URL("https://learn.example.edu/feed"), async () => [
        { address: "not-an-ip", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "unsafe_dns" });
  });

  it("validates public IP literals without a DNS lookup", async () => {
    const resolver = vi.fn<() => Promise<LookupAddress[]>>();
    await expect(
      resolvePublicAddresses(new URL("https://8.8.8.8/feed"), resolver),
    ).resolves.toEqual([PUBLIC_V4]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns address objects when Node requests all pinned answers", async () => {
    const result = await callLookup(
      createPinnedLookup("learn.example.edu", [PUBLIC_V4, PUBLIC_V6]),
      { all: true },
    );

    expect(result).toEqual({ address: [PUBLIC_V4, PUBLIC_V6], family: undefined });
  });

  it("returns the legacy address/family tuple when Node requests one answer", async () => {
    const result = await callLookup(createPinnedLookup("learn.example.edu", [PUBLIC_V4]), {
      all: false,
      family: 4,
    });

    expect(result).toEqual({ address: PUBLIC_V4.address, family: 4 });
  });
});

describe("Blackboard redirect validation", () => {
  it("re-resolves and validates a public redirect target before fetching", async () => {
    const resolved: string[] = [];
    const requested: string[] = [];

    const result = await fetchBlackboardCalendar("https://learn.example.edu/private/feed", {
      allowedHosts: ["learn.example.edu", "cdn.example.edu"],
      resolveAddresses: async (url) => {
        resolved.push(url.hostname);
        return [PUBLIC_V4];
      },
      requestOnce: async (url) => {
        requested.push(url.hostname);
        return url.hostname === "learn.example.edu"
          ? { status: 302, headers: { location: "https://cdn.example.edu/feed" }, body: "" }
          : {
              status: 200,
              headers: { "content-type": "text/calendar" },
              body: CALENDAR,
            };
      },
    });

    expect(result).toBe(CALENDAR);
    expect(resolved).toEqual(["learn.example.edu", "cdn.example.edu"]);
    expect(requested).toEqual(["learn.example.edu", "cdn.example.edu"]);
  });

  it("rejects a redirect to localhost before issuing another request", async () => {
    const requestOnce = vi
      .fn()
      .mockResolvedValue({ status: 302, headers: { location: "https://localhost/feed" }, body: "" });

    await expect(
      fetchBlackboardCalendar("https://learn.example.edu/feed", {
        resolveAddresses: async () => [PUBLIC_V4],
        requestOnce,
      }),
    ).rejects.toBeInstanceOf(BlackboardUrlError);
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a public but unconfigured host", async () => {
    const requestOnce = vi
      .fn()
      .mockResolvedValue({ status: 302, headers: { location: "https://cdn.example.edu/feed" }, body: "" });

    await expect(
      fetchBlackboardCalendar("https://learn.example.edu/feed", {
        resolveAddresses: async () => [PUBLIC_V4],
        requestOnce,
      }),
    ).rejects.toMatchObject({ code: "untrusted_host" });
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect whose DNS set contains a private address", async () => {
    const requestOnce = vi.fn(async (url: URL) =>
      url.hostname === "learn.example.edu"
        ? { status: 302, headers: { location: "https://redirect.example.edu/feed" }, body: "" }
        : { status: 200, headers: { "content-type": "text/calendar" }, body: CALENDAR },
    );

    await expect(
      fetchBlackboardCalendar("https://learn.example.edu/feed", {
        allowedHosts: ["learn.example.edu", "redirect.example.edu"],
        resolveAddresses: async (url) => {
          if (url.hostname === "redirect.example.edu") {
            throw new BlackboardFetchError("unsafe_dns", "Unsafe target.");
          }
          return [PUBLIC_V4];
        },
        requestOnce,
      }),
    ).rejects.toMatchObject({ code: "unsafe_dns" });
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });
});
