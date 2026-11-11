import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Delta } from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  applyListFilter,
  integer,
  useFormatMetric,
  type CompareRow,
} from "@/client/features/gsc-tracker/gscTrackerView";

// Building blocks of the Overview widgets.

const count = (value: number) => integer.format(value);

/** A widget's card: its title, an "Open" link to its tab, and its body. */
export function Widget({
  title,
  onOpen,
  loading,
  children,
}: {
  title: string;
  onOpen: () => void;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="ghost" size="xs" onClick={onOpen}>
          Open
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
      {loading ? <Skeleton className="h-28 w-full" /> : children}
    </section>
  );
}

/** Headline numbers in a row. */
export function Figures({
  items,
}: {
  items: { label: string; value: string; tone?: "good" | "bad" }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p
            className={cn(
              "text-lg font-semibold tabular-nums",
              item.tone === "good" && "text-green-600 dark:text-green-500",
              item.tone === "bad" && "text-destructive",
            )}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** A short ranked list: a label and a value with its change. */
export function TopList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: {
    key: string;
    label: string;
    value: React.ReactNode;
    onClick?: () => void;
  }[];
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center justify-between gap-3 py-1"
            >
              {row.onClick ? (
                <button
                  type="button"
                  className="min-w-0 truncate text-left hover:underline"
                  title={row.label}
                  onClick={row.onClick}
                >
                  {row.label}
                </button>
              ) : (
                <span className="min-w-0 truncate" title={row.label}>
                  {row.label}
                </span>
              )}
              <span className="shrink-0 text-right tabular-nums">
                {row.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many rows each list view holds. */
export function ViewCounts({ rows }: { rows: CompareRow[] }) {
  return (
    <Figures
      items={[
        {
          label: "With impressions",
          value: count(applyListFilter(rows, "all").length),
        },
        {
          label: "New",
          value: count(applyListFilter(rows, "new").length),
          tone: "good",
        },
        {
          label: "Lost",
          value: count(applyListFilter(rows, "lost").length),
          tone: "bad",
        },
        {
          label: "Improved / declined",
          value: `${count(applyListFilter(rows, "improved").length)} / ${count(applyListFilter(rows, "declined").length)}`,
        },
      ]}
    />
  );
}

export function ClicksChange({ row }: { row: CompareRow }) {
  const formatMetric = useFormatMetric();
  return (
    <>
      {formatMetric("clicks", row.current.clicks)}{" "}
      <Delta
        metric="clicks"
        current={row.current.clicks}
        previous={row.previous.clicks}
      />
    </>
  );
}
