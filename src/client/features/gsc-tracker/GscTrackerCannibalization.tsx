import { EmptyState } from "@/client/components/EmptyState";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  useFormatMetric,
  type Metrics,
} from "@/client/features/gsc-tracker/gscTrackerView";

type CannibalQuery = {
  query: string;
  impressions: number;
  clicks: number;
  pages: (Metrics & { url: string; share: number })[];
};

export function CannibalizationList({
  queries,
  onSelect,
}: {
  queries: CannibalQuery[];
  onSelect: (query: string) => void;
}) {
  const formatMetric = useFormatMetric();
  if (queries.length === 0)
    return (
      <EmptyState
        title="No competing pages found"
        description="No query in this period splits its impressions between two or more of your pages."
      />
    );
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Query</TableHead>
            <TableHead>
              Competing pages (share of impressions · position)
            </TableHead>
            <TableHead className="text-right">Impressions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queries.map((item) => (
            <TableRow key={item.query} className="align-top">
              <TableCell className="max-w-56">
                <button
                  type="button"
                  className="text-left break-all hover:underline"
                  onClick={() => onSelect(item.query)}
                >
                  {item.query}
                </button>
              </TableCell>
              <TableCell>
                <ul className="space-y-1">
                  {item.pages.map((page) => (
                    <li key={page.url} className="text-xs">
                      <span className="break-all">{page.url}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {Math.round(page.share * 100)}% ·{" "}
                        {formatMetric("position", page.position)}
                      </span>
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMetric("impressions", item.impressions)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
