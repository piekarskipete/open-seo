import { describe, expect, it, vi } from "vitest";
import { planSyncDays } from "./gscTrackerPlan";
import { sixteenMonthFloor } from "@/server/features/gsc/searchAnalytics";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {},
  isExpectedGrantFailure: () => false,
}));
vi.mock("../repositories/GscTrackerRepository", () => ({
  GscTrackerRepository: {},
}));

// Latest stored day is two days back: 2026-11-08.
const now = new Date("2026-11-10T12:00:00Z");
const fresh = new Date("2026-11-10T09:00:00Z").toISOString();
const stale = new Date("2026-11-09T09:00:00Z").toISOString();

describe("planSyncDays", () => {
  it("starts a new tracker with the recent days, then older history", () => {
    expect(
      planSyncDays(
        { oldestDate: null, newestDate: null, lastSyncedAt: null },
        now,
      ),
    ).toEqual({
      forward: ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"],
      backward: ["2026-11-04", "2026-11-03"],
    });
  });

  it("refetches the settling days once the refresh is stale", () => {
    const plan = planSyncDays(
      {
        oldestDate: "2025-07-12",
        newestDate: "2026-11-08",
        lastSyncedAt: stale,
      },
      now,
    );
    expect(plan.forward).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    // The rest of the budget keeps backfilling.
    expect(plan.backward).toEqual(["2025-07-11", "2025-07-10"]);
  });

  it("has nothing to do when caught up, fresh and back to Google's floor", () => {
    expect(
      planSyncDays(
        {
          oldestDate: "2025-07-09",
          newestDate: "2026-11-08",
          lastSyncedAt: fresh,
        },
        now,
        6,
      ),
    ).toEqual({ forward: [], backward: [] });
  });

  it("catches up a long gap a batch at a time, oldest missing day first", () => {
    const plan = planSyncDays(
      {
        oldestDate: "2026-01-01",
        newestDate: "2026-10-01",
        lastSyncedAt: stale,
      },
      now,
    );
    expect(plan.forward).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(plan.backward).toEqual([]);
  });

  it("never plans a day before the floor requests are clamped to", () => {
    // A day before it would become an empty range Google rejects.
    const plan = planSyncDays(
      {
        oldestDate: "2025-07-14",
        newestDate: "2026-11-08",
        lastSyncedAt: fresh,
      },
      now,
      50,
    );
    expect(plan.backward.at(-1)).toBe(sixteenMonthFloor(now));
  });
});
