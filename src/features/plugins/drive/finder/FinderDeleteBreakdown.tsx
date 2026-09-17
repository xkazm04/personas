import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";

import { kindBucketWeight, kindGroupLabel, visualForEntry } from "../designTokens";

type BucketKey = Parameters<typeof kindBucketWeight>[0];

/**
 * Per-kind chips inside the delete confirmation ("3 Images · 1 PDF"), so the
 * user sees what the selection actually contains before confirming.
 */
export function FinderDeleteBreakdown({ paths, entries }: { paths: string[]; entries: DriveEntry[] }) {
  const { t } = useTranslation();
  const byPath = new Map(entries.map((e) => [e.path, e] as const));
  const counts = new Map<BucketKey, number>();
  for (const p of paths) {
    const entry = byPath.get(p);
    if (!entry) continue;
    const key = visualForEntry(entry).labelKey as BucketKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = Array.from(counts.entries()).sort(
    ([a], [b]) => kindBucketWeight(a) - kindBucketWeight(b),
  );
  if (buckets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {buckets.map(([key, count]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-status-error/10 border border-status-error/25 typo-caption text-foreground"
        >
          <span className="tabular-nums">{count}</span>
          <span>{kindGroupLabel(t, key as Parameters<typeof kindGroupLabel>[1])}</span>
        </span>
      ))}
    </div>
  );
}
