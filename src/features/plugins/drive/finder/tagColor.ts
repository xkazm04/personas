import type { DriveTagColor } from "@/api/drive";

// THE tag colour map for the whole Finder (shell, views, inspector). Tokens
// only, so a tag reads correctly on the light and dark themes alike.
export const TAG_COLOR_CLASS: Record<DriveTagColor, string> = {
  red: "bg-brand-rose",
  orange: "bg-status-warning",
  yellow: "bg-brand-amber",
  green: "bg-brand-emerald",
  blue: "bg-brand-cyan",
  purple: "bg-brand-purple",
  gray: "bg-muted-foreground",
};

export const TAG_RING_CLASS: Record<DriveTagColor, string> = {
  red: "ring-brand-rose",
  orange: "ring-status-warning",
  yellow: "ring-brand-amber",
  green: "ring-brand-emerald",
  blue: "ring-brand-cyan",
  purple: "ring-brand-purple",
  gray: "ring-muted-foreground",
};

/** Solid fill class for a tag swatch / dot. */
export function tagColorClass(color: DriveTagColor): string {
  return TAG_COLOR_CLASS[color] ?? TAG_COLOR_CLASS.gray;
}

/** Ring (outline) class for a selected / focused swatch. */
export function tagRingClass(color: DriveTagColor): string {
  return TAG_RING_CLASS[color] ?? TAG_RING_CLASS.gray;
}
