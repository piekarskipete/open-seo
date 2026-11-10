import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Delta } from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  integer,
  METRIC_LABELS,
  METRICS,
  useFormatMetric,
  type CompareRow,
  type SortState,
} from "@/client/features/gsc-tracker/gscTrackerView";
import type { GscTrackerSortKey } from "@/shared/gsc-tracker";

const PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

/** A header that sorts by `key`, marked when the rows are ordered by it.
 *  The order itself is the Explorer's (see sortRows), not the table's. */
function headerFor(
  key: GscTrackerSortKey,
  label: string,
  sort: SortState | null | undefined,
  onSort: ((key: GscTrackerSortKey) => void) | undefined,
) {
  return function Header() {
    return (
      <SortableHeader
        align="right"
        label={label}
        column={{
          getIsSorted: () => (sort?.key === key ? sort.dir : false),
          getToggleSortingHandler: () =>
            onSort ? () => onSort(key) : undefined,
        }}
      />
    );
  };
}

/**
 * Queries with the current period's numbers and the change from the one
 * before, laid out like the app's other data tables: sortable headers, and
 * pages of rows below.
 */
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
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const showUrls = rows.some((row) => row.urls !== undefined);

  const columns = useMemo<ColumnDef<CompareRow>[]>(
    () => [
      {
        id: "key",
        header: () => keyLabel,
        cell: ({ row }) =>
          onSelect ? (
            <button
              type="button"
              className="block max-w-xl truncate text-left hover:underline"
              title={row.original.key}
              onClick={() => onSelect(row.original.key)}
            >
              {row.original.key}
            </button>
          ) : (
            <span className="block max-w-xl truncate" title={row.original.key}>
              {row.original.key}
            </span>
          ),
      },
      ...METRICS.map(
        (metric): ColumnDef<CompareRow> => ({
          id: metric,
          header: headerFor(metric, METRIC_LABELS[metric], sort, onSort),
          cell: ({ row }) => (
            <>
              <div>{formatMetric(metric, row.original.current[metric])}</div>
              <Delta
                metric={metric}
                current={row.original.current[metric]}
                previous={row.original.previous[metric]}
              />
            </>
          ),
          meta: rightAligned,
        }),
      ),
      ...(showUrls
        ? [
            {
              id: "urls",
              header: headerFor("urls", "URLs", sort, onSort),
              cell: ({ row }) => (
                <span title="Pages this query reached in the period">
                  {integer.format(row.original.urls ?? 0)}
                </span>
              ),
              meta: rightAligned,
            } satisfies ColumnDef<CompareRow>,
          ]
        : []),
    ],
    [formatMetric, keyLabel, onSelect, onSort, showUrls, sort],
  );

  const table = useDataTable({
    data: rows,
    columns,
    withPagination: true,
    state: { pagination },
    onPaginationChange: setPagination,
    getRowId: (row) => row.key,
    // The rows are rebuilt on every render; the Explorer remounts the table
    // when its filter or order changes, so the page only resets then.
    autoResetPageIndex: false,
  });

  return (
    <>
      <div className="p-4">
        <DataTable
          table={table}
          isFiltered
          empty={{
            kind: "filtered",
            title: "Nothing here for this period",
            description: "Try a longer period or another view.",
          }}
        />
      </div>
      {rows.length > 0 ? (
        <TablePagination
          page={pagination.pageIndex + 1}
          pageSize={pagination.pageSize}
          pageSizes={PAGE_SIZES}
          totalCount={rows.length}
          hasNextPage={table.getCanNextPage()}
          isLoading={false}
          onPageChange={(page) =>
            setPagination((current) => ({ ...current, pageIndex: page - 1 }))
          }
          onPageSizeChange={(size: PageSize) =>
            setPagination({ pageIndex: 0, pageSize: size })
          }
        />
      ) : null}
    </>
  );
}
