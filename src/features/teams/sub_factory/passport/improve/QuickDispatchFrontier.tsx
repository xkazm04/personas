// Quick-dispatch variant C — FRONTIER. Metaphor: an expedition map. The point
// of dispatching without arguments is to send a skill somewhere it has NOT
// been — so this variant sorts by thinnest coverage first and each card leads
// with the gap: how many context groups the skill has never touched, plus a
// micro heat-strip (one mini cell per group, shaded exactly like the registry
// heatmap) showing where the blank territory is. The card IS the dispatch
// button; the copy invites the run rather than reporting the past.
import { motion } from 'framer-motion';
import { Compass, Play, Sparkles } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { NEUTRAL_HUE, withAlpha, type QuickDispatchProps, type QuickSkill } from './quickDispatch';

export function QuickDispatchFrontier({ model, busySkill, onDispatch }: QuickDispatchProps) {
  if (model.loading && model.skills.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[4.5rem] rounded-card border border-primary/8 bg-secondary/[0.12] animate-pulse" />
        ))}
      </div>
    );
  }
  if (model.skills.length === 0) {
    return <p className="typo-caption text-foreground/45 py-8 text-center">No skills installed in this repo yet — adopt some from Manage.</p>;
  }

  const sorted = [...model.skills].sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-2">
      <p className="typo-label text-foreground/40 flex items-center gap-1.5">
        <Compass className="w-3 h-3" aria-hidden />
        Thinnest coverage first — send a skill where it has never run.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {sorted.map((s, i) => (
          <FrontierCard key={s.name} skill={s} index={i} busy={busySkill === s.name} onDispatch={onDispatch} />
        ))}
      </div>
    </div>
  );
}

function FrontierCard({ skill, index, busy, onDispatch }: {
  skill: QuickSkill; index: number; busy: boolean; onDispatch: (name: string) => void;
}) {
  const hue = skill.visual?.color ?? NEUTRAL_HUE;
  const Icon = skill.visual?.icon ?? Sparkles;
  const untouched = skill.groups.filter((g) => g.covered === 0).length;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.4) }}
      onClick={() => onDispatch(skill.name)}
      disabled={busy || skill.running}
      className="group flex items-center gap-3 p-3 rounded-card border border-primary/10 bg-secondary/[0.15] hover:border-primary/30 hover:bg-primary/[0.05] transition-colors text-left focus-ring disabled:cursor-not-allowed"
      data-testid={`quick-dispatch-frontier-${skill.name}`}
      aria-label={`Dispatch /${skill.name}`}
    >
      <span className="relative inline-flex items-center justify-center w-9 h-9 rounded-interactive border flex-shrink-0"
        style={{ color: hue, borderColor: withAlpha(hue, 0.25), backgroundColor: withAlpha(hue, 0.08) }}>
        <Icon className="absolute w-4 h-4 transition-opacity group-hover:opacity-0" strokeWidth={1.75} aria-hidden />
        <Play className="w-4 h-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>

      <span className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="typo-caption font-medium text-foreground truncate">{skill.name}</span>
          <span className="typo-caption font-semibold tabular-nums ml-auto flex-shrink-0" style={{ color: hue }}>{skill.pct}%</span>
        </span>
        {/* micro heat-strip: one mini cell per group, heatmap shading */}
        <span className="flex items-center gap-0.5">
          {skill.groups.map((g) => (
            <Tooltip key={g.id} content={`${g.name} — ${g.covered}/${g.units} contexts`} placement="top">
              <span
                className="h-2.5 flex-1 rounded-[2px]"
                style={{
                  backgroundColor: g.covered > 0 ? withAlpha(hue, 0.2 + (g.pct / 100) * 0.6) : undefined,
                  border: g.covered > 0 ? undefined : `1px dashed ${withAlpha(hue, 0.3)}`,
                }}
              />
            </Tooltip>
          ))}
        </span>
        <span className="typo-label text-foreground/40">
          {skill.running
            ? 'Running here now'
            : untouched > 0
              ? `${untouched} of ${skill.groups.length} groups untouched`
              : 'Every group visited'}
        </span>
      </span>
    </motion.button>
  );
}
