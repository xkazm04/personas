// Small shared chrome for the skills workbench header — the shared/specific/
// dormant tally the passport cell already shows, so the modal header echoes the
// cell it opened from. Kept separate so both variants render an identical badge.
import { INK } from '../passportInk';

export function WorkbenchCounts({ counts }: { counts: { reused: number; own: number; dormant?: number } }) {
  return (
    <span className="inline-flex items-baseline gap-2.5">
      <Tally value={counts.reused} label="shared" />
      <Tally value={counts.own} label="specific" />
      {(counts.dormant ?? 0) > 0 && <Tally value={counts.dormant!} label="dormant" hue={INK.amber} />}
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
