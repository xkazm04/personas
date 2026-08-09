// Level 2 — the skill tree: workspace library core at center, one bezier
// branch per adopted project fanning across the upper arc, stroke ∝ usage,
// drift ring per project node, lessons as sprouts on the branch. Entrance
// animation is one-shot pathLength draw + transform fades (never raw cx/cy/r,
// no infinite repeats — prototype-skill austerity rules).
import { useState } from 'react';

import { motion } from 'framer-motion';
import { ArrowLeft, Wand2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { DRIFT_RING } from './driftTokens';
import { LessonsPanel } from './LessonsPanel';
import { SkillTreeBlueprint } from './SkillTreeBlueprint';
import { SkillTreeOrbit } from './SkillTreeOrbit';
import { layoutTree, CORE_X, CORE_Y, TREE_H, TREE_W } from './treeGeometry';
import type { DriftState, SkillTreeModel } from './traceTypes';
import { VersionTimelinePanel } from './VersionTimelinePanel';

export interface SkillTreeViewProps {
  model: SkillTreeModel;
  onBack: () => void;
  onOpenInfo: (skill: string) => void;
}

export function SkillTreeViewBaseline({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const geo = layoutTree(model.branches);
  const Icon = model.visual?.icon ?? Wand2;
  const accent = model.visual?.color ?? undefined;

  return (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      {/* title band — always-rendered chrome */}
      <div className="flex items-center gap-3 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={13} />
          {t.plugins.dev_tools.trace_back}
        </button>
        <button type="button" onClick={() => onOpenInfo(model.skillName)} className="inline-flex items-center gap-2 hover:text-primary transition-colors">
          <Icon size={16} style={accent ? { color: accent } : undefined} />
          <span className="typo-title">{model.skillName}</span>
        </button>
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_tree_stats, {
            projects: model.branches.length,
            invokes: model.totalInvokes,
          })}
        </span>
      </div>

      <svg viewBox={`0 0 ${TREE_W} ${TREE_H}`} className="w-full max-h-[52vh]" role="img" aria-label={model.skillName}>
        {/* branches */}
        {geo.map((g, i) => {
          const b = model.branches[i];
          if (!b) return null;
          return (
            <g key={b.project.id}>
              <motion.path
                d={g.path}
                fill="none"
                strokeLinecap="round"
                strokeWidth={g.strokeWidth}
                strokeDasharray={b.invokes30d === 0 ? '4 6' : undefined}
                style={{ stroke: accent ?? 'currentColor', strokeOpacity: 0.25 + 0.6 * b.weight }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: i * 0.05, ease: 'easeOut' }}
              />
              {/* lesson sprouts */}
              {g.lessonPoints.map((pt, j) => (
                <motion.g
                  key={j}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.05 + j * 0.08 }}
                  style={{ transformOrigin: `${pt.x}px ${pt.y}px` }}
                >
                  <circle
                    cx={pt.x} cy={pt.y} r={5}
                    className={b.lessons[j]?.is_redesign ? 'fill-status-warning cursor-pointer' : 'fill-status-success cursor-pointer'}
                    onClick={() => setOpenLesson(openLesson === `${b.project.id}:${j}` ? null : `${b.project.id}:${j}`)}
                  />
                </motion.g>
              ))}
              {b.lessons.length > 3 && (
                <text x={g.lessonPoints[2]?.x ?? g.node.x} y={(g.lessonPoints[2]?.y ?? g.node.y) - 10} className="fill-foreground/70 typo-caption">
                  +{b.lessons.length - 3}
                </text>
              )}
              {/* project node */}
              <motion.g
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.25 + i * 0.05 }}
                style={{ transformOrigin: `${g.node.x}px ${g.node.y}px` }}
              >
                <circle
                  cx={g.node.x} cy={g.node.y} r={21}
                  className={`fill-secondary ${DRIFT_RING[b.drift]}`}
                  strokeWidth={2.5}
                  strokeDasharray={b.drift === 'unversioned' ? '3 3' : undefined}
                />
                <text x={g.node.x} y={g.node.y - 28} textAnchor="middle" className="fill-foreground typo-caption">
                  {b.project.name.slice(0, 14)}
                </text>
                <text x={g.node.x} y={g.node.y + 4} textAnchor="middle" className="fill-foreground/70" fontSize={11}>
                  v{b.installedVersion ?? '1.0'}
                </text>
              </motion.g>
            </g>
          );
        })}

        {/* workspace/library core */}
        <motion.g initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${CORE_X}px ${CORE_Y}px` }}>
          <circle cx={CORE_X} cy={CORE_Y} r={34} className="fill-secondary stroke-border" strokeWidth={1.5} />
          <circle cx={CORE_X} cy={CORE_Y} r={40} fill="none" style={{ stroke: accent ?? 'currentColor', strokeOpacity: 0.35 }} strokeWidth={1} strokeDasharray="2 4" />
          <text x={CORE_X} y={CORE_Y - 2} textAnchor="middle" className="fill-foreground" fontSize={12}>
            {t.plugins.dev_tools.trace_core_library}
          </text>
          <text x={CORE_X} y={CORE_Y + 14} textAnchor="middle" className="fill-foreground/70" fontSize={11}>
            v{model.libraryVersion ?? '1.0'}
          </text>
        </motion.g>
      </svg>

      {/* drift legend */}
      <div className="flex items-center gap-4 pb-2">
        {(Object.keys(DRIFT_RING) as DriftState[]).map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width={10} height={10} aria-hidden>
              <circle cx={5} cy={5} r={4} fill="none" strokeWidth={2} className={DRIFT_RING[d]} strokeDasharray={d === 'unversioned' ? '2 2' : undefined} />
            </svg>
            {t.plugins.dev_tools[`trace_drift_${d}` as const]}
          </span>
        ))}
      </div>

      {/* opened sprout detail */}
      {openLesson && (() => {
        const [pid, idx] = openLesson.split(':');
        const l = model.branches.find((b) => b.project.id === pid)?.lessons[Number(idx)];
        if (!l) return null;
        return (
          <div className="mb-2 px-3 py-2 rounded-card bg-secondary/60 border border-border/50">
            <div className="typo-caption text-foreground">
              {l.project_name ?? ''} · {l.date ?? ''} · v{l.version ?? '1.0'}
              {l.is_redesign ? ` · ${t.plugins.dev_tools.trace_redesign_flag}` : ''}
            </div>
            <div className="typo-body whitespace-pre-line">{l.lesson}</div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <VersionTimelinePanel timeline={model.timeline} loading={model.loading} />
        <LessonsPanel
          branches={model.branches}
          workspaceLessons={model.workspaceLessons}
          loading={model.loading}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Throwaway variant switcher (prototype skill). Deleted at consolidation.
// Hardcoded labels are deliberate — the switcher never ships.
// ---------------------------------------------------------------------------
const TREE_VARIANTS = [
  { id: 'baseline', label: 'Fan', hint: 'radial branches, upward arc' },
  { id: 'orbit', label: 'Orbit', hint: 'recency rings around the library' },
  { id: 'blueprint', label: 'Blueprint', hint: 'bus + wired module cards' },
] as const;
type TreeVariant = (typeof TREE_VARIANTS)[number]['id'];

export function SkillTreeView(props: SkillTreeViewProps) {
  const [variant, setVariant] = useState<TreeVariant>('baseline');
  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center gap-1 shrink-0">
        {TREE_VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            data-testid={`tree-variant-${v.id}`}
            onClick={() => setVariant(v.id)}
            className={`px-2 py-1 rounded-interactive typo-caption transition-colors ${variant === v.id ? 'bg-primary/15 text-primary' : 'bg-secondary/50 text-foreground hover:bg-secondary'}`}
            title={v.hint}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {variant === 'orbit' ? <SkillTreeOrbit {...props} />
          : variant === 'blueprint' ? <SkillTreeBlueprint {...props} />
          : <SkillTreeViewBaseline {...props} />}
      </div>
    </div>
  );
}
