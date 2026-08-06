// Quick-dispatch variant A — SIGILS. Metaphor: a wall of badges. Each skill is
// a square emblem whose identity (lens icon + colour) sits inside a coverage
// ring — the ring's sweep IS the repo-coverage percentage. Identity-first:
// you recognize the skill by its mark, then read how far it has travelled.
// Click anywhere on the sigil to dispatch it (no args; the skill picks its
// own context, Fleet carries the run).
import { motion } from 'framer-motion';
import { Play, Sparkles } from 'lucide-react';

import { NEUTRAL_HUE, withAlpha, type QuickDispatchProps, type QuickSkill } from './quickDispatch';

const R = 21;
const CIRC = 2 * Math.PI * R;

export function QuickDispatchSigils({ model, busySkill, onDispatch }: QuickDispatchProps) {
  if (model.loading && model.skills.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-32 rounded-card border border-primary/8 bg-secondary/[0.12] animate-pulse" />
        ))}
      </div>
    );
  }
  if (model.skills.length === 0) {
    return <p className="typo-caption text-foreground/45 py-8 text-center">No skills installed in this repo yet — adopt some from Manage.</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2.5">
      {model.skills.map((s, i) => (
        <Sigil key={s.name} skill={s} index={i} busy={busySkill === s.name} onDispatch={onDispatch} />
      ))}
    </div>
  );
}

function Sigil({ skill, index, busy, onDispatch }: {
  skill: QuickSkill; index: number; busy: boolean; onDispatch: (name: string) => void;
}) {
  const hue = skill.visual?.color ?? NEUTRAL_HUE;
  const Icon = skill.visual?.icon ?? Sparkles;
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.4) }}
      onClick={() => onDispatch(skill.name)}
      disabled={busy || skill.running}
      className="group relative flex flex-col items-center gap-1.5 p-3 rounded-card border border-primary/10 bg-secondary/[0.15] hover:border-primary/30 hover:bg-primary/[0.05] transition-colors focus-ring disabled:cursor-not-allowed"
      data-testid={`quick-dispatch-sigil-${skill.name}`}
      aria-label={`Dispatch /${skill.name}`}
    >
      {/* coverage ring around the lens mark */}
      <span className="relative inline-flex items-center justify-center w-14 h-14">
        <svg viewBox="0 0 48 48" className="absolute inset-0 w-full h-full">
          <circle cx="24" cy="24" r={R} fill="none" stroke={withAlpha(hue, 0.14)} strokeWidth="3" />
          <circle
            cx="24" cy="24" r={R} fill="none" stroke={hue} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - skill.pct / 100)}
            transform="rotate(-90 24 24)"
            className={skill.running ? 'animate-pulse' : ''}
          />
        </svg>
        <Icon className="w-5 h-5 transition-opacity group-hover:opacity-0" style={{ color: hue }} strokeWidth={1.75} aria-hidden />
        <Play className="absolute w-5 h-5 text-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="typo-caption font-medium text-foreground truncate max-w-full">{skill.name}</span>
      <span className="typo-data tabular-nums" style={{ color: hue }}>{skill.pct}%</span>
      {/* one dot per context group, lit when the skill has touched it */}
      <span className="flex items-center gap-1">
        {skill.groups.map((g) => (
          <span
            key={g.id}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: g.covered > 0 ? (g.color ?? hue) : undefined, border: g.covered > 0 ? undefined : `1px solid ${withAlpha(hue, 0.3)}` }}
            title={`${g.name} — ${g.covered}/${g.units}`}
          />
        ))}
      </span>
      {skill.running && <span className="absolute top-1.5 right-1.5 typo-label text-status-info">live</span>}
    </motion.button>
  );
}
