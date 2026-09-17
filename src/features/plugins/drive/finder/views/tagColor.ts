import type { DriveTagColor } from "@/api/drive";

/**
 * Tag colour → design-token background class for the tag dots. Duplicated
 * (by agreement) in the Inspector package; keep the two in step.
 */
export const TAG_COLOR_CLASS: Record<DriveTagColor, string> = {
  red: "bg-brand-rose",
  orange: "bg-status-warning",
  yellow: "bg-brand-amber",
  green: "bg-brand-emerald",
  blue: "bg-brand-cyan",
  purple: "bg-brand-purple",
  gray: "bg-muted-foreground",
};

export function tagColorClass(color: DriveTagColor): string {
  return TAG_COLOR_CLASS[color] ?? TAG_COLOR_CLASS.gray;
}
