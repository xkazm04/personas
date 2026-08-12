// Small shared chrome for the skills workbench header — the shared/specific/
// dormant tally the passport cell already shows, so the modal header echoes the
// cell it opened from. Kept separate so both variants render an identical badge.
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../passportInk';

export function WorkbenchCounts({ counts }: { counts: { reused: number; own: number; dormant?: number } }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <span className="inline-flex items-baseline gap-2.5">
      <Tally value={counts.reused} label={d.skills_workbench_counts_shared} />
      <Tally value={counts.own} label={d.skills_workbench_counts_specific} />
      {(counts.dormant ?? 0) > 0 && <Tally value={counts.dormant!} label={d.skills_workbench_counts_dormant} hue={INK.amber} />}
    </span>
  );
}

function Tally({ value, label, hue }: { value: number; label: string; hue?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="typo-caption font-semibold tabular-nums" style={hue ? { color: hue } : undefined}>{value}</span>
      <span className="typo-label" style={hue ? { color: `${hue}B3` } : undefined}>{label}</span>
    </span>
  );
}
