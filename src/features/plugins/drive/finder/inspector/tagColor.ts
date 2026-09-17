import type { DriveTagColor } from "@/api/drive";

// Token-only colour map for the seven tag colours. The views package carries
// its own copy (`views/tagColor.ts`) by agreement — the two packages build in
// parallel and neither may import the other.
const BG: Record<DriveTagColor, string> = {
  red: "bg-brand-rose",
  orange: "bg-status-warning",
  yellow: "bg-brand-amber",
  green: "bg-brand-emerald",
  blue: "bg-brand-cyan",
  purple: "bg-brand-purple",
  gray: "bg-muted-foreground",
};

const RING: Record<DriveTagColor, string> = {
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
  return BG[color] ?? BG.gray;
}

/** Ring (outline) class for a selected / focused swatch. */
export function tagRingClass(color: DriveTagColor): string {
  return RING[color] ?? RING.gray;
}
