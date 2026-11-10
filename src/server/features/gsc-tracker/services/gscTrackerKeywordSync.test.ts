import { describe, expect, it, vi } from "vitest";
import { exactQueryPattern, planKeywordDays } from "./gscTrackerKeywordSync";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {},
  isExpectedGrantFailure: () => false,
}));
vi.mock("../repositories/GscTrackerRepository", () => ({
  GscTrackerRepository: {},
}));
vi.mock("../repositories/GscTrackerKeywordRepository", () => ({
  GscTrackerKeywordRepository: {},
}));

// Latest stored day is two days back: 2026-11-08.
const now = new Date("2026-11-10T12:00:00Z");
const fresh = new Date("2026-11-10T09:00:00Z").toISOString();

function keyword(
  id: string,
  range: { oldestDate: string | null; newestDate: string | null },
) {
  return {
    id,
    projectId: "p1",
    query: id,
    targetUrl: "https://x/",
    startDate: null,
    checkpoint1Date: null,
    checkpoint2Date: null,
    siteId: null,
    lastSyncedAt: range.newestDate ? fresh : null,
    createdAt: "2026-11-01",
    ...range,
  };
}

describe("exactQueryPattern", () => {
  it("matches each phrase exactly, with regex characters escaped", () => {
    const pattern = new RegExp(exactQueryPattern(["c++ jobs", "a.b"]));
    expect(pattern.test("c++ jobs")).toBe(true);
    expect(pattern.test("a.b")).toBe(true);
    expect(pattern.test("axb")).toBe(false);
    expect(pattern.test("c++ jobs remote")).toBe(false);
  });
});

describe("planKeywordDays", () => {
  it("fetches each day once for every phrase that needs it", () => {
    const plan = planKeywordDays(
      [
        keyword("new", { oldestDate: null, newestDate: null }),
        keyword("synced", {
          oldestDate: "2026-11-01",
          newestDate: "2026-11-08",
        }),
      ],
      now,
      6,
    );
    // The new phrase starts with the last four days; the synced one is fresh.
    expect(plan.forward.map((batch) => batch.date)).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(plan.forward[0]?.keywords.map((k) => k.id)).toEqual(["new"]);
    // The rest of the budget goes to older history, newest missing day first.
    expect(
      plan.backward.map((batch) => [
        batch.date,
        batch.keywords.map((k) => k.id),
      ]),
    ).toEqual([
      ["2026-11-04", ["new"]],
      ["2026-11-03", ["new"]],
    ]);
  });

  it("asks once per day for every phrase that needs that day", () => {
    const plan = planKeywordDays(
      [
        keyword("a", { oldestDate: "2026-11-01", newestDate: "2026-11-08" }),
        keyword("b", { oldestDate: "2026-11-01", newestDate: "2026-11-08" }),
      ],
      now,
      2,
    );
    expect(plan.forward).toEqual([]);
    expect(
      plan.backward.map((batch) => [
        batch.date,
        batch.keywords.map((k) => k.id),
      ]),
    ).toEqual([
      ["2026-10-31", ["a", "b"]],
      ["2026-10-30", ["a", "b"]],
    ]);
  });
});
