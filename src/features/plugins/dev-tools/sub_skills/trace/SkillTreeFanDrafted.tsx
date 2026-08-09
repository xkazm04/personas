// RESTYLE "Drafted" — the Fan as a technical drawing. Same geometry as the
// baseline (layoutTree beziers, upward arc) finished with drafting-table
// precision: hairline branches with the run count lettered at mid-branch,
// project CHIPS (rounded rects carrying name · version · drift edge) instead
// of circles, and a title-block core stamp.
import { motion } from 'framer-motion';
import { ArrowLeft, Wand2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { LessonsPanel } from './LessonsPanel';
import type { SkillTreeViewProps } from './SkillTreeView';
import { layoutTree, pointOnCubic, CORE_X, CORE_Y, TREE_H, TREE_W } from './treeGeometry';
import type { DriftState } from './traceTypes';
import { VersionTimelinePanel } from './VersionTimelinePanel';

const DRIFT_FILL: Record<DriftState, string> = {
  in_sync: 'fill-status-success',
  behind: 'fill-status-warning',
  ahead: 'fill-primary',
  customized: 'fill-status-info',
  unversioned: 'fill-border',
};

const CHIP_W = 104;
const CHIP_H = 34;

export function SkillTreeFanDrafted({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  const geo = layoutTree(model.branches);
  const Icon = model.visual?.icon ?? Wand2;
  const accent = model.visual?.color ?? undefined;

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

      <svg viewBox={`0 0 ${TREE_W} ${TREE_H}`} className="w-full max-h-[52vh]" role="img" aria-label={model.skillName}>
        {geo.map((g, i) => {
          const b = model.branches[i];
          if (!b) return null;
          const [p0, c1, c2, p3] = g.controls;
          const mid = pointOnCubic(p0, c1, c2, p3, 0.52);
          return (
            <g key={b.project.id}>
              <motion.path
                d={g.path}
                fill="none"
                strokeLinecap="round"
                strokeWidth={1.25 + 2.5 * Math.sqrt(Math.max(0, Math.min(1, b.weight)))}
                strokeDasharray={b.invokes30d === 0 ? '3 5' : undefined}
                className="stroke-foreground/45"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: i * 0.04, ease: 'easeOut' }}
              />
              {/* mid-branch measurement: the 30d run count, lettered */}
              {b.invokes30d > 0 && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.04 }}>
                  <rect x={mid.x - 14} y={mid.y - 9} width={28} height={16} rx={3} className="fill-background stroke-border" strokeWidth={0.75} />
                  <text x={mid.x} y={mid.y + 3} textAnchor="middle" fontSize={10} className="fill-foreground tabular-nums">
                    {b.invokes30d}×
                  </text>
                </motion.g>
              )}
              {/* project chip */}
              <motion.g
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.04 }}
                style={{ transformOrigin: `${g.node.x}px ${g.node.y}px` }}
              >
                <rect x={g.node.x - CHIP_W / 2} y={g.node.y - CHIP_H / 2} width={CHIP_W} height={CHIP_H} rx={6}
                  className="fill-secondary stroke-border" strokeWidth={1} />
                <rect x={g.node.x - CHIP_W / 2} y={g.node.y - CHIP_H / 2} width={4} height={CHIP_H} rx={2}
                  className={DRIFT_FILL[b.drift]} />
                <text x={g.node.x + 3} y={g.node.y - 3} textAnchor="middle" fontSize={11} className="fill-foreground">
                  {b.project.name.slice(0, 13)}
                </text>
                <text x={g.node.x + 3} y={g.node.y + 11} textAnchor="middle" fontSize={9.5} className="fill-foreground/80 tabular-nums">
                  v{b.installedVersion ?? '1.0'}{b.lessons.length > 0 ? ` · ${b.lessons.length}✎` : ''}
                </text>
              </motion.g>
            </g>
          );
        })}

        {/* title-block core stamp */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <rect x={CORE_X - 62} y={CORE_Y - 24} width={124} height={48} rx={6}
            className="fill-secondary" strokeWidth={1.5} style={{ stroke: accent ?? 'currentColor' }} />
          <line x1={CORE_X - 62} y1={CORE_Y} x2={CORE_X + 62} y2={CORE_Y} className="stroke-border" strokeWidth={0.75} />
          <text x={CORE_X} y={CORE_Y - 8} textAnchor="middle" fontSize={11} className="fill-foreground">
            {t.plugins.dev_tools.trace_core_library}
          </text>
          <text x={CORE_X} y={CORE_Y + 15} textAnchor="middle" fontSize={11} className="fill-foreground tabular-nums">
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
