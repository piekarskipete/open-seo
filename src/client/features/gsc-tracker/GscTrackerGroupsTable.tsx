import { Badge } from "@/client/components/ui/badge";
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
  groupRuleText,
  kindLabel,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import {
  integer,
  METRIC_LABELS,
  METRICS,
  useFormatMetric,
} from "@/client/features/gsc-tracker/gscTrackerView";
import type { listGscTrackerGroups } from "@/serverFunctions/gscTrackerGroups";

type Groups = NonNullable<Awaited<ReturnType<typeof listGscTrackerGroups>>>;
type GroupRow = Groups["groups"][number];

/** The site's page groups with their totals and change for the period. */
export function GroupsTable({
  groups,
  onOpen,
}: {
  groups: GroupRow[];
  onOpen: (groupId: string) => void;
}) {
  const formatMetric = useFormatMetric();
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">URLs</TableHead>
            {METRICS.map((metric) => (
              <TableHead key={metric} className="text-right">
                {METRIC_LABELS[metric]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow
              key={group.id}
              className="cursor-pointer"
              onClick={() => onOpen(group.id)}
            >
              <TableCell className="max-w-md">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{group.name}</span>
                  <Badge variant="secondary" size="sm">
                    {kindLabel(group.kind)}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {groupRuleText(group)}
                </p>
                {group.lastError ? (
                  <p className="text-xs text-destructive">{group.lastError}</p>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {integer.format(group.urls)}
              </TableCell>
              {METRICS.map((metric) => (
                <TableCell key={metric} className="text-right tabular-nums">
                  <div>{formatMetric(metric, group.current[metric])}</div>
                  <Delta
                    metric={metric}
                    current={group.current[metric]}
                    previous={group.previous[metric]}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
