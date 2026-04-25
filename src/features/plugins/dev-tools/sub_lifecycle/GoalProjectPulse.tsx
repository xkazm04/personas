/**
 * Project Pulse — triage view for goals.
 *
 * Metaphor: the project's vital signs at a glance, like a hospital chart.
 * Top strip carries the four status counts. Left rail groups goals by
 * status with Blocked first (the user's attention belongs there), then a
 * "Next up" spotlight on the right that always shows one actionable goal:
 * either the selected one, or auto-picked from blocked / in-flight nearest
 * to completion.
 *
 * Why this differs from baseline: instead of a force-directed graph that
 * requires the user to *parse* the spatial layout to understand state, the
 * data is laid out in priority order. The spotlight teaches the dependency
 * chain ("blocks: X / requires: Y") in plain English so the user never has
 * to trace edges.
 */
import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Target, AlertCircle, Clock, CheckCircle2, Circle,
  ArrowRight, Calendar, Layers, Link2, Activity,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';

interface Props {
  goals: DevGoal[];
  dependencies: DevGoalDependency[];
}

type StatusKey = 'blocked' | 'in-progress' | 'open' | 'done';

const STATUS_META: Record<StatusKey, {
  label: string; icon: typeof Circle; tint: string; bg: string; ring: string; tone: string;
}> = {
  blocked:       { label: 'Blocked',     icon: AlertCircle,   tint: 'text-red-400',     bg: 'bg-red-500/10',     ring: 'border-red-500/30',     tone: 'text-red-400' },
  'in-progress': { label: 'In flight',   icon: Clock,         tint: 'text-amber-400',   bg: 'bg-amber-500/10',   ring: 'border-amber-500/30',   tone: 'text-amber-400' },
  open:          { label: 'Open',        icon: Circle,        tint: 'text-blue-400',    bg: 'bg-blue-500/10',    ring: 'border-blue-500/30',    tone: 'text-blue-400' },
  done:          { label: 'Done',        icon: CheckCircle2,  tint: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'border-emerald-500/30', tone: 'text-emerald-400' },
};

const STATUS_ORDER: StatusKey[] = ['blocked', 'in-progress', 'open', 'done'];

function normalizeStatus(s: string): StatusKey {
  if (s === 'blocked' || s === 'in-progress' || s === 'open' || s === 'done') return s;
  return 'open';
}

function daysUntil(target: string | null): number | null {
  if (!target) return null;
  const d = new Date(target).getTime();
  if (isNaN(d)) return null;
  return Math.round((d - Date.now()) / 86400000);
}

export function GoalProjectPulse({ goals, dependencies }: Props) {
  const { t } = useTranslation();

  // Status partitions
  const grouped = useMemo(() => {
    const buckets: Record<StatusKey, DevGoal[]> = { blocked: [], 'in-progress': [], open: [], done: [] };
    for (const g of goals) buckets[normalizeStatus(g.status)].push(g);
    // Sort each bucket: in-flight by progress desc, blocked by deadline asc, open by order_index, done by completed_at desc
    buckets['in-progress'].sort((a, b) => b.progress - a.progress);
    buckets.blocked.sort((a, b) => {
      const da = daysUntil(a.target_date) ?? Infinity;
      const db = daysUntil(b.target_date) ?? Infinity;
      return da - db;
    });
    buckets.open.sort((a, b) => a.order_index - b.order_index);
    buckets.done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    return buckets;
  }, [goals]);

  // Dependency lookup maps
  const depMaps = useMemo(() => {
    const blocks: Record<string, string[]> = {};      // goalId -> goals it blocks
    const requires: Record<string, string[]> = {};    // goalId -> goals it requires
    for (const d of dependencies) {
      (blocks[d.depends_on_id] ??= []).push(d.goal_id);
      (requires[d.goal_id] ??= []).push(d.depends_on_id);
    }
    return { blocks, requires };
  }, [dependencies]);

  // Auto-select: top blocker > most-progressed in flight > next open
  const initialId = useMemo(() => {
    return grouped.blocked[0]?.id
      ?? grouped['in-progress'][0]?.id
      ?? grouped.open[0]?.id
      ?? grouped.done[0]?.id
      ?? null;
  }, [grouped]);

  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  useEffect(() => { if (!selectedId) setSelectedId(initialId); }, [initialId, selectedId]);

  const selected = useMemo(() => goals.find((g) => g.id === selectedId) ?? null, [goals, selectedId]);
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  return (
    <div className="space-y-4">
      {/* Pulse strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUS_ORDER.map((s) => (
          <PulseTile key={s} status={s} count={grouped[s].length} total={goals.length} />
        ))}
      </div>

      {/* Two-pane: list + spotlight */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
        {/* Left rail — grouped goal list */}
        <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h3 className="typo-section-title">{t.plugins.dev_lifecycle.goal_constellation}</h3>
            <span className="ml-auto typo-caption text-foreground/70 tabular-nums">{goals.length} total</span>
          </div>
          <div className="divide-y divide-primary/5">
            {STATUS_ORDER.filter((s) => grouped[s].length > 0).map((s) => (
              <StatusGroup
                key={s}
                status={s}
                goals={grouped[s]}
                selectedId={selectedId}
                onSelect={setSelectedId}
                blocksMap={depMaps.blocks}
                requiresMap={depMaps.requires}
              />
            ))}
          </div>
        </div>

        {/* Right pane — spotlight */}
        <SpotlightPane
          goal={selected}
          blocks={selected ? (depMaps.blocks[selected.id] ?? []).map((id) => goalById.get(id)).filter(Boolean) as DevGoal[] : []}
          requires={selected ? (depMaps.requires[selected.id] ?? []).map((id) => goalById.get(id)).filter(Boolean) as DevGoal[] : []}
          parent={selected?.parent_goal_id ? goalById.get(selected.parent_goal_id) ?? null : null}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pulse tile — top-strip status counter
// ---------------------------------------------------------------------------

function PulseTile({ status, count, total }: { status: StatusKey; count: number; total: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const pct = total === 0 ? 0 : (count / total) * 100;
  return (
    <div className={`rounded-card border ${meta.ring} ${meta.bg} p-3 flex items-center gap-3`}>
      <div className={`w-9 h-9 rounded-interactive border ${meta.ring} bg-background/40 flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${meta.tint}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-caption uppercase tracking-[0.18em] text-foreground/70">{meta.label}</p>
        <div className="flex items-baseline gap-2">
          <p className={`typo-data-lg ${meta.tone} tabular-nums leading-none`}>{count}</p>
          <p className="text-sm text-foreground/50 tabular-nums">{Math.round(pct)}%</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status group — collapsible-feeling section in the left list
// ---------------------------------------------------------------------------

function StatusGroup({
  status, goals, selectedId, onSelect, blocksMap, requiresMap,
}: {
  status: StatusKey;
  goals: DevGoal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  blocksMap: Record<string, string[]>;
  requiresMap: Record<string, string[]>;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 bg-primary/5">
        <Icon className={`w-3.5 h-3.5 ${meta.tint}`} />
        <span className="typo-caption uppercase tracking-[0.18em] text-foreground/80">{meta.label}</span>
        <span className="typo-caption text-foreground/50 tabular-nums">{goals.length}</span>
      </div>
      <ul>
        {goals.map((g) => {
          const isSelected = g.id === selectedId;
          const blocksCount = (blocksMap[g.id] ?? []).length;
          const requiresCount = (requiresMap[g.id] ?? []).length;
          const days = daysUntil(g.target_date);
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onSelect(g.id)}
                className={[
                  'w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-primary/5',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="typo-body text-foreground truncate font-medium">{g.title}</p>
                    {blocksCount > 0 && (
                      <span className="shrink-0 typo-caption text-amber-400">blocks {blocksCount}</span>
                    )}
                    {requiresCount > 0 && (
                      <span className="shrink-0 typo-caption text-foreground/60">needs {requiresCount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {/* progress bar */}
                    <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden max-w-[160px]">
                      <div
                        className={`h-full rounded-full ${
                          status === 'done' ? 'bg-emerald-400/70'
                          : status === 'blocked' ? 'bg-red-400/70'
                          : status === 'in-progress' ? 'bg-amber-400/70'
                          : 'bg-blue-400/40'
                        }`}
                        style={{ width: `${g.progress}%` }}
                      />
                    </div>
                    <span className="typo-caption text-foreground/60 tabular-nums">{g.progress}%</span>
                    {days !== null && days <= 14 && status !== 'done' && (
                      <span className={`typo-caption tabular-nums ${days < 0 ? 'text-red-400' : days <= 3 ? 'text-amber-400' : 'text-foreground/60'}`}>
                        {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? 'today' : `${days}d`}
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spotlight pane — full detail of the focused goal
// ---------------------------------------------------------------------------

function SpotlightPane({
  goal, blocks, requires, parent,
}: {
  goal: DevGoal | null;
  blocks: DevGoal[];
  requires: DevGoal[];
  parent: DevGoal | null;
}) {
  if (!goal) {
    return (
      <div className="rounded-card border border-dashed border-primary/15 bg-card/20 p-8 text-center">
        <Target className="w-8 h-8 text-foreground/40 mx-auto mb-2" />
        <p className="typo-body text-foreground/70">Pick a goal to inspect its dependencies.</p>
      </div>
    );
  }

  const status = normalizeStatus(goal.status);
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const days = daysUntil(goal.target_date);
  const blockedRequires = requires.filter((r) => normalizeStatus(r.status) !== 'done');
  const isBlocked = status === 'blocked' || blockedRequires.length > 0;

  return (
    <motion.div
      key={goal.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-card border ${meta.ring} ${meta.bg} overflow-hidden`}
    >
      <div className="px-5 py-4 border-b border-primary/10 bg-background/30">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full border ${meta.ring} bg-background/40 flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${meta.tint}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`typo-caption uppercase tracking-[0.18em] ${meta.tone}`}>{meta.label}</p>
            <h3 className="typo-section-title text-foreground mt-0.5">{goal.title}</h3>
            {parent && (
              <p className="typo-caption text-foreground/60 mt-1 flex items-center gap-1">
                <Layers className="w-3 h-3" />
                child of <span className="text-foreground/80 font-medium">{parent.title}</span>
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="typo-caption uppercase tracking-[0.18em] text-foreground/60">Progress</p>
            <p className={`typo-data-lg ${meta.tone} tabular-nums leading-none mt-0.5`}>{goal.progress}%</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Description */}
        {goal.description ? (
          <p className="typo-body text-foreground leading-relaxed">{goal.description}</p>
        ) : (
          <p className="typo-body text-foreground/50 italic">No description.</p>
        )}

        {/* Deadline */}
        {goal.target_date && (
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-foreground/60" />
            <span className="typo-body text-foreground">
              Target: {new Date(goal.target_date).toLocaleDateString()}
            </span>
            {days !== null && (
              <span className={`typo-caption font-medium ${
                days < 0 ? 'text-red-400' : days <= 3 ? 'text-amber-400' : 'text-foreground/70'
              }`}>
                {days < 0 ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
                : days === 0 ? 'due today'
                : `${days} day${days === 1 ? '' : 's'} away`}
              </span>
            )}
          </div>
        )}

        {/* Activity timestamps */}
        {(goal.started_at || goal.completed_at) && (
          <div className="flex items-center gap-3 text-sm text-foreground/70">
            {goal.started_at && <span><Activity className="w-3 h-3 inline mr-1" />Started {new Date(goal.started_at).toLocaleDateString()}</span>}
            {goal.completed_at && <span><CheckCircle2 className="w-3 h-3 inline mr-1 text-emerald-400" />Done {new Date(goal.completed_at).toLocaleDateString()}</span>}
          </div>
        )}

        {/* Dependency chain */}
        {(requires.length > 0 || blocks.length > 0) && (
          <div className="space-y-3 pt-2 border-t border-primary/10">
            {requires.length > 0 && (
              <DependencyList
                title="Requires"
                hint={isBlocked && blockedRequires.length > 0 ? `${blockedRequires.length} not yet done — that's why this is blocked.` : undefined}
                goals={requires}
              />
            )}
            {blocks.length > 0 && (
              <DependencyList
                title="Blocks"
                hint={`Finishing this unblocks ${blocks.length} downstream goal${blocks.length === 1 ? '' : 's'}.`}
                goals={blocks}
              />
            )}
          </div>
        )}

        {requires.length === 0 && blocks.length === 0 && (
          <p className="typo-caption text-foreground/60 pt-2 border-t border-primary/10 flex items-center gap-1.5">
            <Link2 className="w-3 h-3" /> Standalone — no dependencies.
          </p>
        )}
      </div>
    </motion.div>
  );
}

function DependencyList({ title, hint, goals }: { title: string; hint?: string; goals: DevGoal[] }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <p className="typo-caption uppercase tracking-[0.18em] text-foreground/70">{title}</p>
        {hint && <p className="typo-caption text-foreground/60">— {hint}</p>}
      </div>
      <ul className="space-y-1">
        {goals.map((g) => {
          const status = normalizeStatus(g.status);
          const m = STATUS_META[status];
          const Icon = m.icon;
          return (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <Icon className={`w-3.5 h-3.5 ${m.tint} shrink-0`} />
              <span className="text-foreground truncate">{g.title}</span>
              <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{g.progress}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
