import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Delta } from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  useFormatMetric,
  integer,
  METRIC_LABELS,
  METRICS,
  type CompareRow,
  type SortState,
} from "@/client/features/gsc-tracker/gscTrackerView";
import type { GscTrackerSortKey } from "@/shared/gsc-tracker";

const PAGE_SIZE = 100;

/** A right-aligned column header that sorts the table when clicked. */
function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: GscTrackerSortKey;
  label: string;
  sort?: SortState | null;
  onSort?: (key: GscTrackerSortKey) => void;
}) {
  const active = sort?.key === column ? sort.dir : null;
  return (
    <TableHead
      className="text-right"
      aria-sort={
        active ? (active === "asc" ? "ascending" : "descending") : undefined
      }
    >
      {onSort ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => onSort(column)}
        >
          {label}
          {active === "asc" ? <ArrowUp className="size-3" /> : null}
          {active === "desc" ? <ArrowDown className="size-3" /> : null}
        </button>
      ) : (
        label
      )}
    </TableHead>
  );
}

export function CompareTable({
  rows,
  keyLabel,
  onSelect,
  sort,
  onSort,
}: {
  rows: CompareRow[];
  keyLabel: string;
  onSelect?: (key: string) => void;
  /** The column the rows are ordered by, marked in its header. */
  sort?: SortState | null;
  onSort?: (key: GscTrackerSortKey) => void;
}) {
  const formatMetric = useFormatMetric();
  const [shown, setShown] = useState(PAGE_SIZE);
  const showUrls = rows.some((row) => row.urls !== undefined);
  if (rows.length === 0)
    return (
      <EmptyState
        kind="filtered"
        title="Nothing here for this period"
        description="Try a longer period or another view."
      />
    );
  return (
    <div className="space-y-2">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyLabel}</TableHead>
              {METRICS.map((metric) => (
                <SortHeader
                  key={metric}
                  column={metric}
                  label={METRIC_LABELS[metric]}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
              {showUrls ? (
                <SortHeader
                  column="urls"
                  label="URLs"
                  sort={sort}
                  onSort={onSort}
                />
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, shown).map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-md">
                  {onSelect ? (
                    <button
                      type="button"
                      className="text-left break-all hover:underline"
                      onClick={() => onSelect(row.key)}
                    >
                      {row.key}
                    </button>
                  ) : (
                    <span className="break-all">{row.key}</span>
                  )}
                </TableCell>
                {METRICS.map((metric) => (
                  <TableCell key={metric} className="text-right tabular-nums">
                    <div>{formatMetric(metric, row.current[metric])}</div>
                    <Delta
                      metric={metric}
                      current={row.current[metric]}
                      previous={row.previous[metric]}
                    />
                  </TableCell>
                ))}
                {showUrls ? (
                  <TableCell
                    className="text-right tabular-nums"
                    title="Pages this query reached in the period"
                  >
                    {integer.format(row.urls ?? 0)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {integer.format(Math.min(shown, rows.length))} of{" "}
          {integer.format(rows.length)}
        </span>
        {shown < rows.length ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShown((value) => value + PAGE_SIZE)}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}
