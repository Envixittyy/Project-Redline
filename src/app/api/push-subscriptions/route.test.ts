import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRequireAuth = vi.fn();
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: () => mockRequireAuth(),
}));

import { POST } from "./route";

const receiver = crypto.createECDH("prime256v1");
receiver.generateKeys();
const validBody = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-token",
  expirationTime: null,
  keys: {
    p256dh: receiver.getPublicKey("base64url"),
    auth: crypto.randomBytes(16).toString("base64url"),
  },
};

describe("push subscription registration route", () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: "owner-1",
      client: {
        from: vi.fn((table: string) => {
          if (table === "devices") {
            return {
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "device-1" },
                    error: null,
                  }),
                })),
              })),
            };
          }
          return { upsert };
        }),
      },
    });
  });

  function request(body: unknown, origin = "https://forward.example") {
    return new Request("https://forward.example/api/push-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  }

  it("requires an explicit same-origin browser request", async () => {
    const missingOrigin = new Request(
      "https://forward.example/api/push-subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      },
    );
    expect((await POST(missingOrigin)).status).toBe(403);
    expect((await POST(request(validBody, "https://attacker.example"))).status).toBe(
      403,
    );
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/push",
    "https://169.254.169.254/latest/meta-data",
    "https://attacker.example/push",
  ])("rejects a server-side request endpoint: %s", async (endpoint) => {
    const response = await POST(request({ ...validBody, endpoint }));
    expect(response.status).toBe(400);
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it("stores a valid browser-issued subscription for the authenticated owner", async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(201);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "owner-1",
        endpoint: validBody.endpoint,
      }),
      { onConflict: "user_id,endpoint" },
    );
  });
});
