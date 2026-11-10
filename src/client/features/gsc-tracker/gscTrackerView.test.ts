import { expect, it } from "vitest";
import { nextSort, sortRows, type CompareRow } from "./gscTrackerView";

function row(key: string, clicks: number, position: number | null): CompareRow {
  const metrics = { clicks, impressions: 10, ctr: clicks / 10, position };
  return { key, current: metrics, previous: metrics };
}

it("sorts by the chosen column, keeping rows without a value last", () => {
  const rows = [row("a", 5, 7), row("b", 9, null), row("c", 1, 2)];
  expect(
    sortRows(rows, { key: "position", dir: "asc" }).map((r) => r.key),
  ).toEqual(["c", "a", "b"]);
  expect(
    sortRows(rows, { key: "position", dir: "desc" }).map((r) => r.key),
  ).toEqual(["a", "c", "b"]);
  expect(
    sortRows(rows, { key: "clicks", dir: "desc" }).map((r) => r.key),
  ).toEqual(["b", "a", "c"]);
});

it("flips the active column and starts another in its natural order", () => {
  expect(nextSort(null, "position")).toEqual({ key: "position", dir: "asc" });
  expect(nextSort({ key: "clicks", dir: "desc" }, "clicks")).toEqual({
    key: "clicks",
    dir: "asc",
  });
  expect(nextSort({ key: "clicks", dir: "asc" }, "impressions")).toEqual({
    key: "impressions",
    dir: "desc",
  });
});
