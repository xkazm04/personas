import { useMemo } from "react";

import { useTranslation } from "@/i18n/useTranslation";
import { PillGroup } from "@/features/shared/components/forms/PillGroup";

import { kindBucketWeight, kindGroupLabel, visualForEntry } from "../../designTokens";
import type { DriveApi, FinderViewMode } from "../types";

const ALL = "__all__";
type BucketKey = Parameters<typeof kindBucketWeight>[0];

interface Props {
  drive: DriveApi;
  viewMode: FinderViewMode;
  /** The tagged view lists entries from all over Drive; a per-folder filter would mislead. */
  hidden?: boolean;
}

/**
 * Kind-filter strip under the toolbar (classic `DriveKindFilterBar`). Buckets
 * come from the unfiltered folder; hidden when there is nothing to narrow
 * (< 2 kinds), in columns view (navigation-centric) and during a recursive
 * search (results span folders).
 */
export function FinderKindFilter({ drive, viewMode, hidden = false }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;

  const buckets = useMemo(() => {
    const counts = new Map<BucketKey, number>();
    for (const e of drive.entries) {
      const key = visualForEntry(e).labelKey as BucketKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => kindBucketWeight(a) - kindBucketWeight(b));
  }, [drive.entries]);

  if (hidden || buckets.length < 2 || viewMode === "columns" || drive.recursiveResults !== null) {
    return null;
  }

  const options = [
    { value: ALL, label: `${f.filter_all} ${drive.entries.length}` },
    ...buckets.map(([key, count]) => ({
      value: key as string,
      label: `${kindGroupLabel(t, key as Parameters<typeof kindGroupLabel>[1])} ${count}`,
    })),
  ];

  return (
    <div
      className="flex items-center px-3 py-1.5 border-b border-border overflow-x-auto"
      aria-label={f.filter_aria}
      data-testid="finder-kind-filter"
    >
      <PillGroup<string>
        options={options}
        value={drive.kindFilter ?? ALL}
        onChange={(v) => drive.setKindFilter(v === ALL ? null : v)}
        labelClass="typo-caption tabular-nums whitespace-nowrap"
        activeBg="bg-primary/15"
        activeBorder="border-primary/40"
        layoutId="finder-kind-filter"
      />
    </div>
  );
}
