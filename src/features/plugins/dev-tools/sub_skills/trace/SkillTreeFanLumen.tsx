// RESTYLE "Lumen" — the Fan lit from within. Same geometry as the baseline
// (layoutTree beziers, upward arc) finished as light: every branch carries a
// blurred under-glow scaled by usage share, the core radiates a soft accent
// gradient, and node rings sit on faint halos. One-shot entrance only — the
// glow is static (drop-shadows and gradients, no loops).
import { motion } from 'framer-motion';
import { ArrowLeft, Wand2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { DRIFT_RING } from './driftTokens';
import { LessonsPanel } from './LessonsPanel';
import type { SkillTreeViewProps } from './SkillTreeView';
import { layoutTree, CORE_X, CORE_Y, TREE_H, TREE_W } from './treeGeometry';
import { VersionTimelinePanel } from './VersionTimelinePanel';

export function SkillTreeFanLumen({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  const geo = layoutTree(model.branches);
  const Icon = model.visual?.icon ?? Wand2;
  const accent = model.visual?.color ?? '#8b8b8b';

  return (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      <div className="flex items-center gap-3 pb-1">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-primary transition-colors">
          <ArrowLeft size={13} />
          {t.plugins.dev_tools.trace_back}
        </button>
        <button type="button" onClick={() => onOpenInfo(model.skillName)} className="inline-flex items-center gap-2 hover:text-primary transition-colors">
          <Icon size={16} style={{ color: accent }} />
          <span className="typo-title">{model.skillName}</span>
        </button>
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_tree_stats, { projects: model.branches.length, invokes: model.totalInvokes })}
        </span>
      </div>

      <svg viewBox={`0 0 ${TREE_W} ${TREE_H}`} className="w-full max-h-[52vh]" role="img" aria-label={model.skillName}>
        <defs>
          <filter id="lumen-blur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <radialGradient id="lumen-core">
            <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
            <stop offset="70%" stopColor={accent} stopOpacity={0.12} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* core radiance under everything */}
        <circle cx={CORE_X} cy={CORE_Y} r={110} fill="url(#lumen-core)" />

        {geo.map((g, i) => {
          const b = model.branches[i];
          if (!b) return null;
          return (
            <g key={b.project.id}>
              {/* under-glow — the same path, wide, blurred, weight-scaled */}
              <motion.path
                d={g.path} fill="none" strokeLinecap="round"
                strokeWidth={g.strokeWidth * 2.4}
                filter="url(#lumen-blur)"
                style={{ stroke: accent, strokeOpacity: 0.12 + 0.35 * b.weight }}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: 'easeOut' }}
              />
              <motion.path
                d={g.path} fill="none" strokeLinecap="round"
                strokeWidth={Math.max(1.5, g.strokeWidth * 0.7)}
                strokeDasharray={b.invokes30d === 0 ? '4 6' : undefined}
                style={{ stroke: accent, strokeOpacity: 0.5 + 0.45 * b.weight }}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: 'easeOut' }}
              />
              <motion.g
                initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                style={{ transformOrigin: `${g.node.x}px ${g.node.y}px` }}
              >
                {/* halo */}
                <circle cx={g.node.x} cy={g.node.y} r={27} filter="url(#lumen-blur)"
                  style={{ fill: accent, fillOpacity: 0.1 + 0.25 * b.weight }} />
                <circle cx={g.node.x} cy={g.node.y} r={20}
                  className={`fill-background ${DRIFT_RING[b.drift]}`} strokeWidth={2.5}
                  strokeDasharray={b.drift === 'unversioned' ? '3 3' : undefined} />
                <text x={g.node.x} y={g.node.y - 27} textAnchor="middle" fontSize={11.5} className="fill-foreground">
                  {b.project.name.slice(0, 14)}
                </text>
                <text x={g.node.x} y={g.node.y + 4} textAnchor="middle" fontSize={10} className="fill-foreground tabular-nums">
                  {b.invokes30d > 0 ? `${b.invokes30d}×` : `v${b.installedVersion ?? '1.0'}`}
                </text>
                {b.lessons.length > 0 && (
                  <circle cx={g.node.x + 16} cy={g.node.y - 14} r={4}
                    className={b.lessons.some((l) => l.is_redesign) ? 'fill-status-warning' : 'fill-status-success'} />
                )}
              </motion.g>
            </g>
          );
        })}

        {/* luminous core */}
        <motion.g initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${CORE_X}px ${CORE_Y}px` }}>
          <circle cx={CORE_X} cy={CORE_Y} r={36} className="fill-background" strokeWidth={2} style={{ stroke: accent, strokeOpacity: 0.8 }} />
          <text x={CORE_X} y={CORE_Y - 3} textAnchor="middle" fontSize={12} className="fill-foreground">
            {t.plugins.dev_tools.trace_core_library}
          </text>
          <text x={CORE_X} y={CORE_Y + 14} textAnchor="middle" fontSize={11} className="fill-foreground tabular-nums">
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
