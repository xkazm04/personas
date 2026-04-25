/**
 * Dependency Flow — kanban swimlanes with dependency-aware badges.
 *
 * Metaphor: a production line. Goals flow left → right (Open → In progress
 * → Done) and a Blocked column sits at the front as the explicit roadblock
 * pile. Each card encodes its relationships through plain-English badges:
 * "blocks 3 / needs 1" — so the user grasps dependencies without parsing a
 * graph. A "Next up" highlight crowns the first card in the rightmost
 * non-empty actionable column so the user always knows where to start.
 *
 * Why this differs from baseline + Pulse: this view stresses *flow* and
 * *throughput*. The user sees how work moves and where it jams. Pulse is
 * a triage list; this is a Gantt-cousin without the timeline.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Target, AlertCircle, Clock, CheckCircle2, Circle,
  Calendar, ChevronRight, Layers, Zap, GitBranch,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';

interface Props {
  goals: DevGoal[];
  dependencies: DevGoalDependency[];
}

type ColumnKey = 'blocked' | 'open' | 'in-progress' | 'done';

const COLUMNS: { key: ColumnKey; label: string; sub: string; icon: typeof Circle; tint: string; bg: string; ring: string }[] = [
  { key: 'blocked',     label: 'Blocked',     sub: 'fix this first',         icon: AlertCircle,  tint: 'text-red-400',     bg: 'bg-red-500/8',     ring: 'border-red-500/25' },
  { key: 'open',        label: 'Open',        sub: 'ready to start',         icon: Circle,       tint: 'text-blue-400',    bg: 'bg-blue-500/8',    ring: 'border-blue-500/25' },
  { key: 'in-progress', label: 'In progress', sub: 'work happening now',     icon: Clock,        tint: 'text-amber-400',   bg: 'bg-amber-500/8',   ring: 'border-amber-500/25' },
  { key: 'done',        label: 'Done',        sub: 'shipped',                icon: CheckCircle2, tint: 'text-emerald-400', bg: 'bg-emerald-500/8', ring: 'border-emerald-500/25' },
];

function normalizeStatus(s: string): ColumnKey {
  if (s === 'blocked' || s === 'open' || s === 'in-progress' || s === 'done') return s;
  return 'open';
}

function daysUntil(target: string | null): number | null {
  if (!target) return null;
  const d = new Date(target).getTime();
  if (isNaN(d)) return null;
  return Math.round((d - Date.now()) / 86400000);
}

export function GoalDependencyFlow({ goals, dependencies }: Props) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const columns = useMemo(() => {
    const buckets: Record<ColumnKey, DevGoal[]> = { blocked: [], open: [], 'in-progress': [], done: [] };
    for (const g of goals) buckets[normalizeStatus(g.status)].push(g);
    buckets['in-progress'].sort((a, b) => b.progress - a.progress);
    buckets.open.sort((a, b) => a.order_index - b.order_index);
    buckets.blocked.sort((a, b) => {
      const da = daysUntil(a.target_date) ?? Infinity;
      const db = daysUntil(b.target_date) ?? Infinity;
      return da - db;
    });
    buckets.done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    return buckets;
  }, [goals]);

  const depMaps = useMemo(() => {
    const blocks: Record<string, string[]> = {};
    const requires: Record<string, string[]> = {};
    for (const d of dependencies) {
      (blocks[d.depends_on_id] ??= []).push(d.goal_id);
      (requires[d.goal_id] ??= []).push(d.depends_on_id);
    }
    return { blocks, requires };
  }, [dependencies]);

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  // Pick "Next up" — preferred order: most-progressed in-flight, top open with no unfinished requires, top blocked
  const nextUpId = useMemo(() => {
    const inFlight = columns['in-progress'][0];
    if (inFlight) return inFlight.id;
    const readyOpen = columns.open.find((g) => {
      const reqs = depMaps.requires[g.id] ?? [];
      return reqs.every((rid) => goalById.get(rid)?.status === 'done');
    });
    if (readyOpen) return readyOpen.id;
    return columns.blocked[0]?.id ?? null;
  }, [columns, depMaps.requires, goalById]);

  // Highlighted set — when hovering a card, light up its dependency siblings
  const highlightedIds = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const set = new Set<string>([hoveredId]);
    for (const id of depMaps.blocks[hoveredId] ?? []) set.add(id);
    for (const id of depMaps.requires[hoveredId] ?? []) set.add(id);
    return set;
  }, [hoveredId, depMaps]);

  return (
    <div className="space-y-4">
      {/* Header strip — what the user is looking at */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <Target className="w-4 h-4 text-primary self-center" />
        <h3 className="typo-section-title">{t.plugins.dev_lifecycle.goal_constellation}</h3>
        <span className="typo-caption text-foreground/60">flow view · hover a card to highlight its dependencies</span>
      </div>

      {/* Swimlanes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {COLUMNS.map((col) => {
          const items = columns[col.key];
          const Icon = col.icon;
          return (
            <div
              key={col.key}
              className={`rounded-card border ${col.ring} ${col.bg} flex flex-col min-h-[200px]`}
            >
              {/* Column header */}
              <div className="px-3 py-2.5 border-b border-primary/10 flex items-center gap-2 bg-background/30">
                <Icon className={`w-4 h-4 ${col.tint}`} />
                <span className="typo-caption uppercase tracking-[0.18em] text-foreground/80">{col.label}</span>
                <span className="typo-caption text-foreground/50 tabular-nums">{items.length}</span>
                <span className="ml-auto typo-caption text-foreground/50">{col.sub}</span>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 flex-1">
                {items.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="typo-caption text-foreground/40">empty</p>
                  </div>
                ) : (
                  items.map((g) => (
                    <FlowCard
                      key={g.id}
                      goal={g}
                      isNextUp={g.id === nextUpId}
                      blocks={(depMaps.blocks[g.id] ?? []).map((id) => goalById.get(id)).filter(Boolean) as DevGoal[]}
                      requires={(depMaps.requires[g.id] ?? []).map((id) => goalById.get(id)).filter(Boolean) as DevGoal[]}
                      parent={g.parent_goal_id ? goalById.get(g.parent_goal_id) ?? null : null}
                      dim={hoveredId !== null && !highlightedIds.has(g.id)}
                      isLink={hoveredId !== null && hoveredId !== g.id && highlightedIds.has(g.id)}
                      onHover={setHoveredId}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 typo-caption text-foreground/60 flex-wrap">
        <LegendDot icon={Zap} className="text-violet-400" label="Next up — start here" />
        <LegendDot icon={GitBranch} className="text-amber-400" label="blocks N — finishing unblocks N goals" />
        <LegendDot icon={Layers} className="text-foreground/70" label="needs N — waits on N goals" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow card — surfaces dependency *counts* as plain-English badges
// ---------------------------------------------------------------------------

function FlowCard({
  goal, isNextUp, blocks, requires, parent, dim, isLink, onHover,
}: {
  goal: DevGoal;
  isNextUp: boolean;
  blocks: DevGoal[];
  requires: DevGoal[];
  parent: DevGoal | null;
  dim: boolean;
  isLink: boolean;
  onHover: (id: string | null) => void;
}) {
  const status = normalizeStatus(goal.status);
  const days = daysUntil(goal.target_date);
  const blockedRequires = requires.filter((r) => normalizeStatus(r.status) !== 'done');
  const allRequiresDone = requires.length > 0 && blockedRequires.length === 0;

  return (
    <motion.div
      onMouseEnter={() => onHover(goal.id)}
      onMouseLeave={() => onHover(null)}
      animate={{
        opacity: dim ? 0.35 : 1,
        scale: isNextUp || isLink ? 1.0 : 1,
      }}
      transition={{ duration: 0.18 }}
      className={[
        'relative rounded-interactive border p-3 bg-card/60 cursor-default transition-colors',
        isNextUp ? 'border-violet-500/50 shadow-elevation-2 bg-violet-500/8'
        : isLink  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-primary/10 hover:border-primary/25',
      ].join(' ')}
    >
      {isNextUp && (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500 text-white typo-caption font-semibold uppercase tracking-[0.15em]">
          <Zap className="w-3 h-3" /> Next up
        </span>
      )}

      {/* Title */}
      <p className="typo-body text-foreground font-medium leading-snug">{goal.title}</p>

      {/* Parent breadcrumb */}
      {parent && (
        <p className="typo-caption text-foreground/60 mt-0.5 flex items-center gap-1 truncate">
          <ChevronRight className="w-3 h-3 shrink-0" />
          <span className="truncate">{parent.title}</span>
        </p>
      )}

      {/* Progress bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              status === 'done' ? 'bg-emerald-400/70'
              : status === 'blocked' ? 'bg-red-400/70'
              : status === 'in-progress' ? 'bg-amber-400/70'
              : 'bg-blue-400/40'
            }`}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
        <span className="typo-caption text-foreground/60 tabular-nums shrink-0">{goal.progress}%</span>
      </div>

      {/* Badge row */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {blocks.length > 0 && (
          <Badge tone="amber" icon={GitBranch}>
            blocks {blocks.length}
          </Badge>
        )}
        {requires.length > 0 && (
          <Badge tone={allRequiresDone ? 'emerald' : status === 'blocked' ? 'red' : 'neutral'} icon={Layers}>
            needs {blockedRequires.length}/{requires.length}
          </Badge>
        )}
        {days !== null && status !== 'done' && (
          <Badge tone={days < 0 ? 'red' : days <= 3 ? 'amber' : 'neutral'} icon={Calendar}>
            {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? 'today' : `${days}d`}
          </Badge>
        )}
        {status === 'open' && allRequiresDone && (
          <Badge tone="emerald" icon={CheckCircle2}>ready</Badge>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

function Badge({ tone, icon: Icon, children }: { tone: 'amber' | 'emerald' | 'red' | 'neutral'; icon: typeof Calendar; children: React.ReactNode }) {
  const cls = {
    amber:   'bg-amber-500/10   text-amber-400   border-amber-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    red:     'bg-red-500/10     text-red-400     border-red-500/25',
    neutral: 'bg-primary/5      text-foreground/80 border-primary/15',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${cls} typo-caption font-medium tabular-nums`}>
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}

function LegendDot({ icon: Icon, className, label }: { icon: typeof Calendar; className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${className}`} />
      {label}
    </span>
  );
}
