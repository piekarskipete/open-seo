import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getGscTrackerRankComparison,
  saveGscTrackerRankLink,
} from "@/serverFunctions/gscTrackerOverview";

const DEVICES = [
  { value: "mobile" as const, label: "Mobile", icon: null },
  { value: "desktop" as const, label: "Desktop", icon: null },
];

/** Settings: the Rank Tracking domain the phrases are compared with. */
export function RankLinkSettings({ projectId }: { projectId: string }) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const month = new Date().toISOString().slice(0, 7);
  const comparison = useQuery({
    queryKey: ["gscTrackerRank", siteId, month],
    queryFn: () =>
      getGscTrackerRankComparison({ data: { projectId, siteId, month } }),
  });
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (link: {
      configId: string | null;
      device?: "mobile" | "desktop";
    }) => saveGscTrackerRankLink({ data: { projectId, siteId, ...link } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerRank", siteId],
      }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't save the link")),
  });
  const data = comparison.data;
  const items = [
    { value: "none", label: "Not linked" },
    ...(data?.configs ?? []).map((config) => ({
      value: config.id,
      label: `${config.domain}${config.locationName ? ` · ${config.locationName}` : ""} · ${config.languageCode}${config.id === data?.suggested ? " (matches)" : ""}`,
    })),
  ];
  return (
    <div className="space-y-1">
      <div className="text-sm">Compare with Rank Tracking</div>
      {data && data.configs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This project has no Rank Tracking domain yet. Add one in Rank Tracking
          to compare its positions here.
        </p>
      ) : (
        <>
          <Select
            items={items}
            value={data?.link?.configId ?? "none"}
            onValueChange={(value: string | null) =>
              save.mutate({
                configId: !value || value === "none" ? null : value,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label="Rank Tracking domain"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.link?.devices === "both" ? (
            <SegmentedToggle
              showLabels
              value={data.link.device}
              onChange={(device) =>
                save.mutate({ configId: data.link?.configId ?? null, device })
              }
              items={DEVICES}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Followed phrases show the domain&apos;s Rank Tracking position under
            Search Console&apos;s, marked by how well they agree.
          </p>
        </>
      )}
    </div>
  );
}
