// Quick-dispatch variant B — LEDGER. Metaphor: an engineering record. One
// dense row per skill; the centrepiece is a segmented coverage bar where each
// segment is a context group sized by how many contexts it holds, filled in
// the group's colour at the skill's coverage intensity — the same shading
// grammar as the registry heatmap, flattened onto a single line. Reads like a
// balance sheet: name · where it has been · total % · activity. Row click
// dispatches (no args, Fleet).
import { motion } from 'framer-motion';
import { Play, Sparkles } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { NEUTRAL_HUE, withAlpha, type QuickDispatchProps, type QuickSkill } from './quickDispatch';

export function QuickDispatchLedger({ model, busySkill, onDispatch }: QuickDispatchProps) {
  const { t } = useTranslation();

  if (model.loading && model.skills.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-10 rounded-interactive border border-primary/8 bg-secondary/[0.12] animate-pulse" />
        ))}
      </div>
    );
  }
  if (model.skills.length === 0) {
    return <p className="typo-caption text-foreground/45 py-8 text-center">{t.plugins.dev_tools.skills_workbench_quick_empty}</p>;
  }

  return (
    <div className="flex flex-col rounded-card border border-primary/10 bg-secondary/[0.12] overflow-hidden">
      {model.skills.map((s, i) => (
        <Row key={s.name} skill={s} index={i} busy={busySkill === s.name} onDispatch={onDispatch} />
      ))}
    </div>
  );
}

function Row({ skill, index, busy, onDispatch }: {
  skill: QuickSkill; index: number; busy: boolean; onDispatch: (name: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const hue = skill.visual?.color ?? NEUTRAL_HUE;
  const Icon = skill.visual?.icon ?? Sparkles;
  const totalUnits = skill.groups.reduce((n, g) => n + g.units, 0) || 1;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.025, 0.35) }}
      onClick={() => onDispatch(skill.name)}
      disabled={busy || skill.running}
      className="group grid grid-cols-[minmax(9rem,14rem)_1fr_3.5rem_2.5rem] items-center gap-3 px-3 h-10 border-b border-primary/[0.06] last:border-b-0 hover:bg-primary/[0.04] transition-colors text-left disabled:cursor-not-allowed"
      data-testid={`quick-dispatch-row-${skill.name}`}
      aria-label={tx(d.skills_workbench_quick_dispatch_aria, { skill: skill.name })}
    >
      {/* identity */}
      <span className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
          style={{ color: hue, borderColor: withAlpha(hue, 0.25), backgroundColor: withAlpha(hue, 0.08) }}>
          <Icon className="w-3 h-3" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="typo-caption font-medium text-foreground truncate">{skill.name}</span>
        {skill.running && <span className="typo-label text-status-info flex-shrink-0">{d.skills_workbench_quick_running}</span>}
      </span>

      {/* segmented coverage bar — one segment per group, width ∝ contexts */}
      <span className="flex h-2 rounded-full overflow-hidden bg-primary/[0.06] gap-px">
        {skill.groups.map((g) => (
          <Tooltip key={g.id} content={tx(d.skills_workbench_quick_group_hint, { name: g.name, covered: g.covered, units: g.units })} placement="top">
            <span
              className="h-full"
              style={{
                width: `${(g.units / totalUnits) * 100}%`,
                backgroundColor: g.covered > 0
                  ? withAlpha(g.color ?? hue, 0.25 + (g.pct / 100) * 0.65)
                  : 'transparent',
              }}
            />
          </Tooltip>
        ))}
      </span>

      {/* total */}
      <span className="typo-caption font-semibold tabular-nums text-right" style={{ color: hue }}>{skill.pct}%</span>

      {/* activity / action */}
      <span className="flex items-center justify-end">
        <span className="typo-label text-foreground/35 tabular-nums group-hover:hidden">{skill.invokes30d > 0 ? `${skill.invokes30d}×` : ''}</span>
        <Play className="w-3.5 h-3.5 text-primary hidden group-hover:block" aria-hidden />
      </span>
    </motion.button>
  );
}
