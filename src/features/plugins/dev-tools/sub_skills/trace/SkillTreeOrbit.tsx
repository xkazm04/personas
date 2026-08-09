// VARIANT "Orbit" — a gravity well. Mental model: the library is a star and
// the projects ORBIT it; the orbit radius encodes RECENCY (fresh runs sit
// close, stale ones drift out) and node size encodes usage share. Drift
// stays on the node ring. A full-360 spatial read vs the baseline's upward
// fan: distance from the core answers "who is drifting away from this
// skill?" at a glance.
import { motion } from 'framer-motion';
import { ArrowLeft, Wand2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { DRIFT_RING } from './driftTokens';
import { LessonsPanel } from './LessonsPanel';
import type { SkillTreeViewProps } from './SkillTreeView';
import { VersionTimelinePanel } from './VersionTimelinePanel';

const W = 800;
const H = 560;
const CX = W / 2;
const CY = H / 2;
/** Orbit radii for the recency bands: ran this week / this month / cold. */
const BANDS = [110, 175, 240];
const DAY_MS = 86_400_000;

function bandOf(lastInvokedAt: number | null, now: number): number {
  if (lastInvokedAt == null) return 2;
  const days = (now - lastInvokedAt) / DAY_MS;
  return days <= 7 ? 0 : days <= 30 ? 1 : 2;
}

export function SkillTreeOrbit({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  const Icon = model.visual?.icon ?? Wand2;
  const accent = model.visual?.color ?? undefined;
  const now = Date.now();

  // Deterministic angular spread: branches sorted by weight get evenly spaced
  // angles so heavy orbiters don't clump; start at -90° (12 o'clock).
  const placed = model.branches.map((b, i) => {
    const angle = -90 + (360 / Math.max(1, model.branches.length)) * i;
    const r = BANDS[bandOf(b.lastInvokedAt, now)] ?? BANDS[2]!;
    const rad = (angle * Math.PI) / 180;
    return { b, x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  });

  return (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      <div className="flex items-center gap-3 pb-1">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-primary transition-colors">
          <ArrowLeft size={13} />
          {t.plugins.dev_tools.trace_back}
        </button>
        <button type="button" onClick={() => onOpenInfo(model.skillName)} className="inline-flex items-center gap-2 hover:text-primary transition-colors">
          <Icon size={16} style={accent ? { color: accent } : undefined} />
          <span className="typo-title">{model.skillName}</span>
        </button>
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_tree_stats, { projects: model.branches.length, invokes: model.totalInvokes })}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-h-[56vh]" role="img" aria-label={model.skillName}>
        {/* orbit rings — the recency bands, labelled at 3 o'clock */}
        {BANDS.map((r, i) => (
          <g key={r}>
            <circle cx={CX} cy={CY} r={r} fill="none" strokeWidth={1} className="stroke-border/60" strokeDasharray={i === 2 ? '3 5' : undefined} />
            <text x={CX + r + 6} y={CY + 3} fontSize={10} className="fill-foreground/60">
              {i === 0 ? '7d' : i === 1 ? '30d' : t.plugins.dev_tools.trace_tier_cold}
            </text>
          </g>
        ))}

        {/* orbiters */}
        {placed.map(({ b, x, y }, i) => (
          <motion.g
            key={b.project.id}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.05, type: 'spring', stiffness: 160, damping: 18 }}
            style={{ transformOrigin: `${x}px ${y}px` }}
          >
            {/* tether — faint line to the core, opacity by usage share */}
            <line x1={CX} y1={CY} x2={x} y2={y} strokeWidth={1}
              style={{ stroke: accent ?? 'currentColor', strokeOpacity: 0.08 + 0.3 * b.weight }} />
            <circle cx={x} cy={y} r={10 + 12 * Math.sqrt(b.weight)}
              className={`fill-secondary ${DRIFT_RING[b.drift]}`} strokeWidth={2.5}
              strokeDasharray={b.drift === 'unversioned' ? '3 3' : undefined} />
            <text x={x} y={y - (16 + 12 * Math.sqrt(b.weight))} textAnchor="middle" className="fill-foreground" fontSize={11}>
              {b.project.name.slice(0, 14)}
            </text>
            <text x={x} y={y + 4} textAnchor="middle" className="fill-foreground" fontSize={10}>
              {b.invokes30d > 0 ? `${b.invokes30d}×` : `v${b.installedVersion ?? '1.0'}`}
            </text>
            {b.lessons.length > 0 && (
              <circle cx={x + 12 + 12 * Math.sqrt(b.weight)} cy={y - 8} r={4}
                className={b.lessons.some((l) => l.is_redesign) ? 'fill-status-warning' : 'fill-status-success'} />
            )}
          </motion.g>
        ))}

        {/* the star — library core */}
        <motion.g initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <circle cx={CX} cy={CY} r={44} className="fill-secondary stroke-border" strokeWidth={1.5} />
          <circle cx={CX} cy={CY} r={52} fill="none" strokeWidth={1.5}
            style={{ stroke: accent ?? 'currentColor', strokeOpacity: 0.4 }} />
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} className="fill-foreground">
            {t.plugins.dev_tools.trace_core_library}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" fontSize={12} className="fill-foreground tabular-nums">
            v{model.libraryVersion ?? '1.0'}
          </text>
        </motion.g>
      </svg>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <VersionTimelinePanel timeline={model.timeline} loading={model.loading} />
        <LessonsPanel branches={model.branches} workspaceLessons={model.workspaceLessons} loading={model.loading} />
      </div>
    </div>
  );
}
