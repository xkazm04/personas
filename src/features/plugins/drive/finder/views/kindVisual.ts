import type { LucideIcon } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { Translations } from "@/i18n/en";
import { kindLabel, visualForEntry } from "../../designTokens";

/** The kind-bucket taxonomy is `designTokens`'s (test-guarded); only its colours are replaced here. */
export type KindBucket = ReturnType<typeof visualForEntry>["labelKey"];

export interface KindVisual {
  Icon: LucideIcon;
  /** Token tint: folders read as primary, everything else as body text. */
  tint: string;
}

export function kindVisual(entry: DriveEntry): KindVisual {
  const { Icon } = visualForEntry(entry);
  return {
    Icon,
    tint: entry.kind === "folder" ? "text-primary" : "text-foreground",
  };
}

export function bucketOf(entry: DriveEntry): KindBucket {
  return visualForEntry(entry).labelKey;
}

export function kindLabelFor(t: Translations, entry: DriveEntry): string {
  return kindLabel(t, visualForEntry(entry));
}

export function isImageEntry(entry: DriveEntry): boolean {
  return entry.kind === "file" && (entry.mime ?? "").startsWith("image/");
}
