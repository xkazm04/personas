// Shared row primitives for the Skills Manager — memory binding icon (click
// cycles internal → Obsidian → none), usage line (transcript-mined invokes),
// and the per-skill context-coverage bar. The 30-day window is stated once in
// the panel footers, never here.
import { Brain, CircleOff, Database } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { SkillCoverageRow } from '@/api/devTools/devTools';
import { useTranslation, type Translations } from '@/i18n/useTranslation';

import { nextBinding, type MemoryBinding } from './skillsManagerData';

const BINDING_HUE: Record<MemoryBinding, string> = {
  project: 'var(--primary)',
  vault: '#8B5CF6',
  none: 'rgba(148,163,184,.6)',
};

const BINDING_ICON: Record<MemoryBinding, typeof Brain> = {
  project: Database,
  vault: Brain,
  none: CircleOff,
};

/** Short human name for a binding (used in labels, toasts, switch hints). */
export function bindingLabel(t: Translations, b: MemoryBinding): string {
  const d = t.plugins.dev_tools;
  return b === 'project' ? d.skills_memory_internal : b === 'vault' ? d.skills_memory_vault : d.skills_memory_none;
}

/** Memory-binding icon; click cycles the binding (patches SKILL.md). */
export function MemoryBindingButton({ binding, onSwitch }: {
  binding: string | null | undefined;
  onSwitch: (next: MemoryBinding) => void;
}) {
  const { t, tx } = useTranslation();
  const current: MemoryBinding = binding === 'project' || binding === 'vault' ? binding : 'none';
  const Icon = BINDING_ICON[current];
  const next = nextBinding(binding);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSwitch(next); }}
      title={tx(t.plugins.dev_tools.skills_memory_hint, { current: bindingLabel(t, current), next: bindingLabel(t, next) })}
      className="p-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring flex-shrink-0"
      data-testid="skills-manager-memory-switch"
    >
      <Icon className="w-3.5 h-3.5" style={{ color: BINDING_HUE[current] }} aria-hidden />
    </button>
  );
}

/** Terse transcript-mined usage: `12× · 2d ago`. Null usage renders nothing —
 *  no telemetry ≠ unused. */
export function UsageLine({ invokes30d, lastInvokedAt }: { invokes30d: number; lastInvokedAt: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 typo-label text-foreground/40 whitespace-nowrap tabular-nums">
      {invokes30d}×
      {lastInvokedAt && <>· <RelativeTime timestamp={lastInvokedAt} className="tabular-nums" /></>}
    </span>
  );
}

/** Context-coverage bar + percentage for a context-tracked skill. */
export function CoverageBar({ row, total }: { row: SkillCoverageRow | undefined; total: number }) {
  const { t, tx } = useTranslation();
  const covered = row?.coveredContexts ?? 0;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const hue = pct >= 65 ? '#34D399' : pct >= 30 ? '#F59E0B' : 'rgba(148,163,184,.7)';
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={tx(t.plugins.dev_tools.skills_coverage_hint, { covered, total })}>
      <span className="w-16 h-[4px] rounded-full bg-foreground/10 overflow-hidden flex-shrink-0">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: hue }} />
      </span>
      <span className="typo-label tabular-nums" style={{ color: hue }}>{pct}%</span>
    </span>
  );
}
