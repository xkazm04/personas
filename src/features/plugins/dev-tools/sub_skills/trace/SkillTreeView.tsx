// Level 2 — the Fan, "Drafted" finish (prototype winner, 2026-08-09): the
// library as a title-block stamp, one hairline bezier per adopted project
// with the 30-day run count lettered mid-branch, and project CHIPS carrying
// name · version · lesson count with a drift-coloured edge. Geometry stays
// in treeGeometry.ts (pure, tested); entrances are one-shot draws + springs,
// nothing loops.
import { useMemo, useState } from 'react';

import { motion } from 'framer-motion';
import { ArrowLeft, Globe, Network } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { DRIFT_FILL, DRIFT_ORDER } from './driftTokens';
import { LessonsPanel } from './LessonsPanel';
import { layoutTree, pointOnCubic, CORE_X, CORE_Y, TREE_H, TREE_W } from './treeGeometry';
import type { SkillTreeModel } from './traceTypes';
import { VersionTimelinePanel } from './VersionTimelinePanel';

export interface SkillTreeViewProps {
  model: SkillTreeModel;
  onBack: () => void;
  onOpenInfo: (skill: string) => void;
}

const CHIP_W = 104;
const CHIP_H = 34;

export function SkillTreeView({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  // CircuitWires precedent: reduced motion skips the one-shot draws/springs.
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  // Icon encodes the method's scope (context-tracked vs agnostic), mirroring
  // the Level-1 rows; the skill's accent colour still identifies the family.
  const Icon = model.contextTracked ? Network : Globe;
  const accent = model.visual?.color ?? undefined;

  // Geometry + mid-branch label anchors — pure math, recomputed only when
  // the branch set changes (not on hover/panel re-renders).
  const scene = useMemo(() => {
    const geo = layoutTree(model.branches);
    return geo.map((g, i) => {
      const [p0, c1, c2, p3] = g.controls;
      return { g, b: model.branches[i], mid: pointOnCubic(p0, c1, c2, p3, 0.52) };
    });
  }, [model.branches]);

  return (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      {/* title band */}
      <div className="flex items-center gap-3 pb-1">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-primary transition-colors">
          <ArrowLeft size={13} />
          {t.plugins.dev_tools.trace_back}
        </button>
        {(() => {
          const infoButton = (
            <button
              type="button"
              onClick={() => onOpenInfo(model.skillName)}
              className="inline-flex items-center gap-2 hover:text-primary transition-colors"
            >
              <Icon size={18} style={accent ? { color: accent } : undefined} />
              <span className="typo-title">{model.skillName}</span>
            </button>
          );
          return model.contextTracked
            ? <Tooltip content={t.plugins.dev_tools.skills_info_context_tracked}>{infoButton}</Tooltip>
            : infoButton;
        })()}
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_tree_stats, { projects: model.branches.length, invokes: model.totalInvokes })}
        </span>
      </div>

      <svg viewBox={`0 0 ${TREE_W} ${TREE_H}`} className="w-full max-h-[52vh]" role="img" aria-label={model.skillName}>
        {scene.map(({ g, b, mid }, i) => {
          if (!b) return null;
          const dim = hovered !== null && hovered !== b.project.id;
          return (
            <g
              key={b.project.id}
              onMouseEnter={() => setHovered(b.project.id)}
              onMouseLeave={() => setHovered(null)}
              className="transition-opacity duration-200"
              opacity={dim ? 0.35 : 1}
            >
              <title>
                {`${b.project.name} · v${b.installedVersion ?? '1.0'} · ${tx(t.plugins.dev_tools.trace_cell_invokes, { count: b.invokes30d })}`}
              </title>
              <motion.path
                d={g.path}
                fill="none"
                strokeLinecap="round"
                strokeWidth={1.25 + 2.5 * Math.sqrt(Math.max(0, Math.min(1, b.weight)))}
                strokeDasharray={b.invokes30d === 0 ? '3 5' : undefined}
                className="stroke-foreground/45"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: i * 0.04, ease: 'easeOut' }}
              />
              {/* mid-branch measurement: the 30d run count, lettered */}
              {b.invokes30d > 0 && (
                <motion.g initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.04 }}>
                  <rect x={mid.x - 14} y={mid.y - 9} width={28} height={16} rx={3} className="fill-background stroke-border" strokeWidth={0.75} />
                  <text x={mid.x} y={mid.y + 3} textAnchor="middle" fontSize={10} className="fill-foreground tabular-nums">
                    {b.invokes30d}×
                  </text>
                </motion.g>
              )}
              {/* project chip */}
              <motion.g
                initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.04, type: 'spring', stiffness: 220, damping: 20 }}
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
              {/* freshest-run clock under the chip, hover-revealed */}
              {hovered === b.project.id && b.lastInvokedAt != null && (
                <foreignObject x={g.node.x - CHIP_W / 2} y={g.node.y + CHIP_H / 2 + 2} width={CHIP_W} height={18}>
                  <div className="text-center typo-caption text-foreground">
                    <RelativeTime timestamp={b.lastInvokedAt} showTooltip={false} />
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}

        {/* title-block core stamp — drawn last so branch roots tuck under it */}
        <motion.g initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
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

      {/* drift legend */}
      <div className="flex items-center gap-4 pb-2">
        {DRIFT_ORDER.map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width={10} height={10} aria-hidden>
              <rect x={2} y={0} width={4} height={10} rx={2} className={DRIFT_FILL[d]} />
            </svg>
            {t.plugins.dev_tools[`trace_drift_${d}` as const]}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <VersionTimelinePanel timeline={model.timeline} loading={model.loading} />
        <LessonsPanel branches={model.branches} workspaceLessons={model.workspaceLessons} loading={model.loading} />
      </div>
    </div>
  );
}
