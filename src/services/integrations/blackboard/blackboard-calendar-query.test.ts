import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRequireAuthenticatedSupabase = vi.fn();
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: () => mockRequireAuthenticatedSupabase(),
}));

import { listBlackboardCalendarProjectionsInRange } from "./blackboard-repository";

describe("listBlackboardCalendarProjectionsInRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully queries external_records and returns calendar projections", async () => {
    const mockRows = [
      {
        id: "rec-1",
        account_id: "acc-1",
        external_uid: "uid-1",
        task_id: null,
        school_item_id: null,
        normalized_title: "CS101 Final Exam",
        course_code: "CS101",
        course_id: "course-1",
        source_url: "https://learn.example.edu/exam/1",
        due_at: "2030-01-15T10:00:00.000Z",
        due_date: "2030-01-15",
        due_precision: "instant",
        content_hash: "a".repeat(64),
        missing_since: null,
        courses: { id: "course-1", code: "CS101", name: "Computer Science", color: "#38bdf8" },
      },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockIs = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockResolvedValue({ data: mockRows, error: null });

    const mockClient = {
      from: vi.fn(() => ({
        select: mockSelect,
        eq: mockEq,
        is: mockIs,
        limit: mockLimit,
      })),
    };

    mockRequireAuthenticatedSupabase.mockResolvedValue({
      client: mockClient,
      userId: "user-1",
    });

    const result = await listBlackboardCalendarProjectionsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
      "UTC",
    );

    expect(mockClient.from).toHaveBeenCalledWith("external_records");
    expect(mockSelect).toHaveBeenCalledWith(
      "id,account_id,external_uid,task_id,school_item_id,normalized_title,course_code,course_id,source_url,due_at,due_date,due_precision,content_hash,missing_since,courses(id,code,name,color)",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "rec-1",
      provider: "blackboard",
      title: "CS101 Final Exam",
      startsAt: "2030-01-15T10:00:00.000Z",
    });
  });

  it("throws and logs structured PostgREST diagnostics on database error", async () => {
    const postgrestError = {
      code: "42703",
      message: "column external_records.school_item_id does not exist",
      details: null,
      hint: null,
    };

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockIs = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockResolvedValue({ data: null, error: postgrestError });

    const mockClient = {
      from: vi.fn(() => ({
        select: mockSelect,
        eq: mockEq,
        is: mockIs,
        limit: mockLimit,
      })),
    };

    mockRequireAuthenticatedSupabase.mockResolvedValue({
      client: mockClient,
      userId: "user-1",
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      listBlackboardCalendarProjectionsInRange(
        "2030-01-01T00:00:00.000Z",
        "2030-01-31T23:59:59.000Z",
        "UTC",
      ),
    ).rejects.toEqual(postgrestError);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[blackboard] Failed to load calendar records: {"code":"42703","message":"column external_records.school_item_id does not exist"'),
    );

    consoleErrorSpy.mockRestore();
  });
});
