import { driveFormatBytes, type DriveEntry } from "@/api/drive";
import { Badge } from "@/features/shared/components/display/Badge";
import { AbsoluteTime } from "@/features/shared/components/display/AbsoluteTime";
import { Numeric } from "@/features/shared/components/display/Numeric";
import { useTranslation } from "@/i18n/useTranslation";
import {
  kindBucketWeight,
  kindGroupLabel,
  visualForEntry,
  type DriveFileVisual,
} from "../../designTokens";
import { InspectorSection } from "./InspectorSection";

type DriveKindLabelKey = DriveFileVisual["labelKey"];

/** Count, total size, kind breakdown and modified range for a multi-selection. */
export function MultiSummary({ entries }: { entries: DriveEntry[] }) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;

  const counts = new Map<DriveKindLabelKey, number>();
  for (const e of entries) {
    const k = visualForEntry(e).labelKey;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const buckets = Array.from(counts.entries()).sort(
    ([a], [b]) => kindBucketWeight(a) - kindBucketWeight(b),
  );
  const totalBytes = entries.reduce((sum, e) => sum + (e.kind === "file" ? e.size : 0), 0);

  // ISO stamps sort chronologically as strings — no Date parse needed.
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const e of entries) {
    if (!e.modified) continue;
    if (oldest === null || e.modified < oldest) oldest = e.modified;
    if (newest === null || e.modified > newest) newest = e.modified;
  }

  return (
    <InspectorSection title={tx(f.insp_multi_n, { count: entries.length })} testId="inspector-multi">
      <div className="space-y-3">
        {totalBytes > 0 && (
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 items-baseline">
            <span className="typo-caption text-foreground">{f.insp_multi_total_size}</span>
            <Numeric className="typo-data text-foreground">{driveFormatBytes(totalBytes)}</Numeric>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {buckets.map(([key, count]) => (
            <Badge key={key} variant="neutral" size="sm">
              <Numeric>{count}</Numeric>
              <span>{kindGroupLabel(t, key)}</span>
            </Badge>
          ))}
        </div>
        {oldest && newest && (
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 items-baseline">
            <span className="typo-caption text-foreground">{f.insp_multi_range}</span>
            <span className="typo-body text-foreground">
              <AbsoluteTime timestamp={oldest} variant="date" />
              {oldest !== newest && (
                <>
                  <span aria-hidden> – </span>
                  <AbsoluteTime timestamp={newest} variant="date" />
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}
