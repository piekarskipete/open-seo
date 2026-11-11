import { describe, expect, it } from "vitest";
import { compareDay, summarizeRank } from "@/shared/gsc-tracker-rank";

describe("compareDay", () => {
  it("rates how close Rank Tracking is to Search Console's average", () => {
    expect(compareDay(4.2, { position: 6, url: null })).toBe("match");
    expect(compareDay(4.2, { position: 12, url: null })).toBe("close");
    expect(compareDay(4.2, { position: 30, url: null })).toBe("differs");
    // Not found in the checked results while Search Console has a position.
    expect(compareDay(4.2, { position: null, url: null })).toBe("differs");
    // Only one source measured the day.
    expect(compareDay(undefined, { position: 3, url: null })).toBeNull();
    expect(compareDay(4.2, undefined)).toBeNull();
  });
});

describe("summarizeRank", () => {
  it("counts agreeing days and flags another ranking URL", () => {
    const summary = summarizeRank({
      gscDays: {
        "2026-11-01": { position: 3 },
        "2026-11-02": { position: 3 },
        "2026-11-03": { position: 3 },
      },
      rankDays: {
        "2026-11-01": { position: 4, url: "https://x/a/" },
        "2026-11-02": { position: 25, url: "https://x/a/" },
        "2026-11-03": { position: 5, url: "https://www.x/b" },
        // No Search Console day to compare with.
        "2026-11-04": { position: 5, url: "https://x/b" },
      },
      targetUrl: "https://x/a",
    });
    expect(summary).toMatchObject({
      compared: 3,
      agreeing: 2,
      // Two of three days is under the 70% that reads as agreeing.
      verdict: "differs",
      latest: { position: 5 },
      otherUrl: "https://x/b",
    });
  });

  it("agrees when most days are close and says nothing without overlap", () => {
    expect(
      summarizeRank({
        gscDays: { "2026-11-01": { position: 8 } },
        rankDays: { "2026-11-01": { position: 7, url: "https://x/a" } },
        targetUrl: "https://x/a/",
      }),
    ).toMatchObject({ verdict: "agrees", otherUrl: null });
    expect(
      summarizeRank({ gscDays: {}, rankDays: {}, targetUrl: "https://x/a" }),
    ).toMatchObject({ compared: 0, verdict: null, latest: null });
  });
});
