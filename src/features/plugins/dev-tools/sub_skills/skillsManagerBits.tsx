// Shared row primitives for the Skills Manager prototype variants — memory
// binding icon (click cycles internal → Obsidian → none), usage line
// (transcript-mined 30d invokes), and the per-skill context-coverage bar.
import { Brain, CircleOff, Database } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { SkillCoverageRow } from '@/api/devTools/devTools';

import { nextBinding, type MemoryBinding } from './skillsManagerData';

const BINDING_META: Record<MemoryBinding, { icon: typeof Brain; label: string; hue: string }> = {
  project: { icon: Database, label: 'Memory: internal ledger', hue: 'var(--primary)' },
  vault: { icon: Brain, label: 'Memory: Obsidian vault', hue: '#8B5CF6' },
  none: { icon: CircleOff, label: 'Memory: none', hue: 'rgba(148,163,184,.6)' },
};

/** Memory-binding icon; click cycles the binding (patches SKILL.md). */
export function MemoryBindingButton({ binding, onSwitch }: {
  binding: string | null | undefined;
  onSwitch: (next: MemoryBinding) => void;
}) {
  const current: MemoryBinding = binding === 'project' || binding === 'vault' ? binding : 'none';
  const meta = BINDING_META[current];
  const Icon = meta.icon;
  const next = nextBinding(binding);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSwitch(next); }}
      title={`${meta.label} — click to switch to ${next === 'project' ? 'internal' : next === 'vault' ? 'Obsidian' : 'none'}`}
      className="p-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring flex-shrink-0"
      data-testid="skills-manager-memory-switch"
    >
      <Icon className="w-3.5 h-3.5" style={{ color: meta.hue }} aria-hidden />
    </button>
  );
}

/** Terse transcript-mined usage: `12× · 2d ago`. The 30-day window is stated
 *  ONCE in the panel footer, never per row. Null usage renders nothing — no
 *  telemetry ≠ unused. */
export function UsageLine({ invokes30d, lastInvokedAt }: { invokes30d: number; lastInvokedAt: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 typo-label text-foreground/40 whitespace-nowrap tabular-nums">
      {invokes30d}×
      {lastInvokedAt && <>· <RelativeTime timestamp={lastInvokedAt} className="tabular-nums" /></>}
    </span>
  );
}

/** Context-coverage bar + percentage for a context-tracked skill (30d). */
export function CoverageBar({ row, total }: { row: SkillCoverageRow | undefined; total: number }) {
  const covered = row?.coveredContexts ?? 0;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const hue = pct >= 65 ? '#34D399' : pct >= 30 ? '#F59E0B' : 'rgba(148,163,184,.7)';
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={`${covered}/${total} contexts with fresh notes (30d)`}>
      <span className="w-16 h-[4px] rounded-full bg-foreground/10 overflow-hidden flex-shrink-0">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: hue }} />
      </span>
      <span className="typo-label tabular-nums" style={{ color: hue }}>{pct}%</span>
    </span>
  );
}
