import { useTranslation } from '@/i18n/useTranslation';
import type { VersionRow } from '../../libs/versionMatrixRows';

/**
 * Primary status pill for a (version, model) row. Priority: active beats
 * archived beats measured beats unmeasured. The baseline marker is shown
 * separately (a star in the Version cell), so it can co-exist with any status.
 */
export function VersionStatusBadge({ row }: { row: VersionRow }) {
  const { t } = useTranslation();
  const lab = t.agents.lab;

  let label: string;
  let cls: string;
  if (row.isActive) {
    label = lab.vr_status_active;
    cls = 'bg-primary/15 text-primary';
  } else if (row.isArchived) {
    label = lab.vr_status_archived;
    cls = 'bg-secondary/40 text-foreground';
  } else if (row.rating) {
    label = lab.vr_status_measured;
    cls = 'bg-blue-500/10 text-blue-300';
  } else {
    label = lab.vr_status_unmeasured;
    cls = 'bg-secondary/30 text-foreground';
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption font-medium ${cls}`}>
      {row.isActive && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" />}
      {label}
    </span>
  );
}
