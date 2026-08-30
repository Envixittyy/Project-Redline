import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockDispatch = vi.fn().mockResolvedValue({
  tasksEvaluated: 2,
  taskNotificationsPlanned: 1,
  calendarEvaluated: 1,
  calendarNotificationsPlanned: 0,
  schoolEvaluated: 1,
  schoolNotificationsPlanned: 0,
  deferredReconciled: 0,
  deferredExpired: 0,
  pushesSent: 1,
  pushesFailed: 0,
  pushesDeferred: 0,
  pushesExpired: 0,
});

vi.mock("@/services/notifications/notification-dispatcher", () => ({
  evaluateAndDispatchNotifications: (...args: unknown[]) => mockDispatch(...args),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: () => mockRequireAuth(),
}));

const mockAdminClient = {
  auth: {
    admin: {
      listUsers: vi.fn(() =>
        Promise.resolve({
          data: { users: [{ id: "owner-user-id" }] },
          error: null,
        }),
      ),
    },
  },
};

vi.mock("@/services/supabase/admin", () => ({
  getSupabaseAdminClient: () => mockAdminClient,
}));

import { GET, POST } from "./route";

describe("Notification Dispatch Route Handler (Phase 4D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOTIFICATION_DISPATCH_SECRET;
    delete process.env.INTERNAL_CRON_SECRET;
    process.env.CRON_SECRET = "super-secret-cron-key";
  });

  it("rejects cron authentication when every configured secret is absent", async () => {
    delete process.env.CRON_SECRET;
    mockRequireAuth.mockRejectedValue(new Error("User is not authenticated."));

    const response = await POST(
      new Request("https://redline.local/api/notifications/dispatch", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mockAdminClient.auth.admin.listUsers).not.toHaveBeenCalled();
  });

  it("rejects wrong and malformed cron credentials", async () => {
    mockRequireAuth.mockRejectedValue(new Error("User is not authenticated."));

    for (const authorization of [
      "Bearer wrong-secret",
      "Bearer",
      "Bearer super-secret-cron-key extra",
      "Basic super-secret-cron-key",
    ]) {
      const response = await POST(
        new Request("https://redline.local/api/notifications/dispatch", {
          method: "POST",
          headers: { authorization },
        }),
      );
      expect(response.status).toBe(401);
    }
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 401 when request is not authenticated and has no cron secret", async () => {
    mockRequireAuth.mockRejectedValue(new Error("User is not authenticated."));

    const request = new Request("https://redline.local/api/notifications/dispatch", {
      method: "POST",
      headers: {},
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.message).toContain("Unauthorized");
  });

  it("authenticates via Bearer Authorization cron secret header", async () => {
    const request = new Request("https://redline.local/api/notifications/dispatch", {
      method: "POST",
      headers: {
        authorization: "Bearer super-secret-cron-key",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.authenticatedVia).toBe("cron_secret");
    expect(json.usersProcessed).toBe(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("authenticates via x-cron-secret header", async () => {
    const request = new Request("https://redline.local/api/notifications/dispatch", {
      method: "GET",
      headers: {
        "x-cron-secret": "super-secret-cron-key",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.authenticatedVia).toBe("cron_secret");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("authenticates via active user session when cron secret is absent", async () => {
    mockRequireAuth.mockResolvedValue({
      client: {},
      userId: "user-session-123",
    });

    const request = new Request("https://redline.local/api/notifications/dispatch", {
      method: "POST",
      headers: {},
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.authenticatedVia).toBe("user_session");
    expect(json.userId).toBe("user-session-123");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("does not allow a user session to trigger dispatch through GET", async () => {
    mockRequireAuth.mockResolvedValue({
      client: {},
      userId: "user-session-123",
    });

    const response = await GET(
      new Request("https://redline.local/api/notifications/dispatch", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
