import { cn } from "cn";
import { Check } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  TAG_COLORS,
  tagColor,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import {
  GSC_TRACKER_TAG_COLORS,
  type GscTrackerTagColor,
} from "@/shared/gsc-tracker";

/** A tag's name on its color. */
export function TagChip({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center truncate rounded-full px-2 py-0.5 text-xs font-medium",
        TAG_COLORS[tagColor(color)].chip,
        className,
      )}
    >
      {name}
    </span>
  );
}

/** A swatch button that opens the palette. */
export function TagColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (color: GscTrackerTagColor) => void;
  disabled?: boolean;
}) {
  const current = tagColor(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Color: ${TAG_COLORS[current].label}`}
          />
        }
      >
        <span
          className={cn("size-3.5 rounded-full", TAG_COLORS[current].swatch)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-36">
        {GSC_TRACKER_TAG_COLORS.map((color) => (
          <DropdownMenuItem key={color} onClick={() => onChange(color)}>
            <span
              className={cn("size-3 rounded-full", TAG_COLORS[color].swatch)}
            />
            {TAG_COLORS[color].label}
            {color === current ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
