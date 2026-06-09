import { useMemo } from "react";

import { useTranslation } from "@/i18n/useTranslation";
import type { UseDriveResult } from "../hooks/useDrive";
import {
  kindBucketWeight,
  kindGroupLabel,
  visualForEntry,
} from "../designTokens";

/**
 * Kind-filter strip above the file list. Derives the kind buckets present in
 * the current folder (unfiltered) and lets the user narrow the view to one —
 * alongside the name search. Hidden when there's nothing to narrow (a single
 * kind / empty folder), in columns view (navigation-centric), and during a
 * recursive search (those results span folders, so a per-folder filter would
 * mislead).
 */
export function DriveKindFilterBar({ drive }: { drive: UseDriveResult }) {
  const { t } = useTranslation();

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of drive.entries) {
      const key = visualForEntry(e).labelKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(
      ([a], [b]) =>
        kindBucketWeight(a as Parameters<typeof kindBucketWeight>[0]) -
        kindBucketWeight(b as Parameters<typeof kindBucketWeight>[0]),
    );
  }, [drive.entries]);

  if (
    buckets.length < 2 ||
    drive.viewMode === "columns" ||
    drive.recursiveResults !== null
  ) {
    return null;
  }

  const active = drive.kindFilter;

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-primary/10 overflow-x-auto">
      <Chip
        label={t.common.all}
        count={drive.entries.length}
        active={!active}
        onClick={() => drive.setKindFilter(null)}
      />
      {buckets.map(([key, count]) => (
        <Chip
          key={key}
          label={kindGroupLabel(t, key as Parameters<typeof kindGroupLabel>[1])}
          count={count}
          active={active === key}
          onClick={() => drive.setKindFilter(active === key ? null : key)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-caption font-medium whitespace-nowrap transition-colors focus-ring ${
        active
          ? "bg-cyan-500/20 border border-cyan-500/45 text-cyan-50"
          : "bg-secondary/40 border border-primary/15 text-foreground hover:bg-cyan-500/10 hover:text-cyan-100 hover:border-cyan-500/25"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
