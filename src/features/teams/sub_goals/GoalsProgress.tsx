/**
 * GoalsProgress — portfolio-level goals overview (Goals v2 L2 "Progress" view).
 *
 * PROTOTYPE ROUND IN FLIGHT: the exported component wraps three directional
 * takes on the same problem behind a temporary tab switcher (throwaway — the
 * winner consolidates back to a single component):
 *  - Baseline  — the original exact-date scatter (10px nodes on a real time axis)
 *  - Sequence  — filmstrip: uniform 20px frames in chronological ORDER, no axis
 *  - Buckets   — matrix: fixed time-bucket columns, 20px nodes wrap in cells
 * Shared primitives (data hook, drawer, legend, node) live in progressShared.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { isOngoing, isComplete } from './goalStatus';
import { GoalAtmosphere } from './goalsTheme';
import {
  DAY,
  GoalSquare,
  ProgressLegend,
  ProgressEmpty,
  useGoalsPortfolio,
  useGoalDrawer,
  groupByProject,
  anchorDate,
} from './progressShared';
import { GoalsProgressSequence } from './GoalsProgressSequence';
import { GoalsProgressBuckets } from './GoalsProgressBuckets';

/** Fixed side-column widths so the axis overlay + node tracks share one scale. */
const LEFT_W = 200;
const TRAY_W = 108;
/** Cluster resolution — nodes quantized to the same slot stack vertically. */
const SLOTS = 64;
/** Vertical distance between stacked nodes (px). */
const STACK_STEP = 11;
/** Max squares drawn per stack; the rest collapse into a "+N" count. */
const STACK_CAP = 5;

interface PlottedGoal {
  goal: DevGoal;
  /** 0..1 position along the time domain (already clamped). */
  frac: number;
  overdue: boolean;
}

/** First-of-month ticks inside the domain, as axis fractions. */
function monthTicks(start: number, end: number): Array<{ frac: number; label: string }> {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const ticks: Array<{ frac: number; label: string }> = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  if (d.getTime() < start) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= end) {
    const frac = (d.getTime() - start) / (end - start);
    if (frac > 0.015 && frac < 0.985) ticks.push({ frac, label: fmt.format(d) });
    d.setMonth(d.getMonth() + 1);
  }
  // Crowded axis (year-plus domains): keep every other label, lines stay.
  if (ticks.length > 9) return ticks.map((t, i) => (i % 2 === 0 ? t : { ...t, label: '' }));
  return ticks;
}

function GoalsProgressBaseline() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { projects, allGoals } = useGoalsPortfolio();
  const { openGoal, drawer } = useGoalDrawer(allGoals ?? []);

  const { rows, domain, totalGoals } = useMemo(() => {
    const goals = allGoals ?? [];
    const now = Date.now();

    // Time domain: every plottable date ∪ today, padded, clamped to a window
    // that keeps the recent past + near future readable even with far outliers.
    let min = now;
    let max = now;
    for (const g of goals) {
      const at = anchorDate(g);
      if (at === null) continue;
      if (at < min) min = at;
      if (at > max) max = at;
    }
    const pad = Math.max(4 * DAY, (max - min) * 0.06);
    let start = Math.max(min - pad, now - 180 * DAY);
    let end = Math.min(max + pad, now + 240 * DAY);
    if (end - start < 42 * DAY) {
      // Sparse data — hold a ~6-week window so nodes don't smear edge-to-edge.
      start = Math.min(start, now - 14 * DAY);
      end = start + 42 * DAY;
    }
    const span = end - start;
    const toFrac = (ts: number) => Math.min(0.995, Math.max(0.005, (ts - start) / span));

    const rows = groupByProject(projects, goals).map((row) => {
      const slots = new Map<number, PlottedGoal[]>();
      const undated: DevGoal[] = [];
      for (const g of row.goals) {
        const at = anchorDate(g);
        if (at === null) {
          undated.push(g);
          continue;
        }
        const frac = toFrac(at);
        const plotted: PlottedGoal = { goal: g, frac, overdue: at < now && isOngoing(g.status) };
        const slot = Math.round(frac * SLOTS);
        const stack = slots.get(slot);
        if (stack) stack.push(plotted);
        else slots.set(slot, [plotted]);
      }

      const stacks = [...slots.values()]
        .map((nodes) => ({
          // Ongoing above done inside a stack — the live work stays visible.
          nodes: nodes.sort((a, b) => Number(isComplete(a.goal.status)) - Number(isComplete(b.goal.status))),
          frac: nodes.reduce((s, n) => s + n.frac, 0) / nodes.length,
        }))
        .sort((a, b) => a.frac - b.frac);

      return {
        ...row,
        stacks,
        undated,
        maxStack: stacks.reduce((m, s) => Math.max(m, Math.min(s.nodes.length, STACK_CAP)), 1),
      };
    });

    return {
      rows,
      domain: { start, end, todayFrac: toFrac(now), ticks: monthTicks(start, end) },
      totalGoals: goals.length,
    };
  }, [allGoals, projects]);

  // Still fetching — render nothing rather than flashing the empty state.
  if (allGoals === null) return null;
  if (rows.length === 0) return <ProgressEmpty dl={dl} />;

  let nodeIndex = 0;
  const stagger = () => Math.min(nodeIndex++, 24) * 18;

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />
      <ProgressLegend dl={dl} />

      <div className="relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden">
        {/* Time grid overlay — month lines + today, spanning every row. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0"
          style={{ left: LEFT_W, right: TRAY_W }}
        >
          {domain.ticks.map((tick, i) => (
            <div
              key={i}
              className="absolute inset-y-0 w-px bg-primary/5"
              style={{ left: `${tick.frac * 100}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 w-px bg-violet-400/40"
            style={{ left: `${domain.todayFrac * 100}%` }}
          />
        </div>

        {/* Axis header */}
        <div className="relative flex items-stretch border-b border-primary/10 bg-secondary/20">
          <div className="shrink-0 px-3 py-2" style={{ width: LEFT_W }}>
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: totalGoals })}
            </span>
          </div>
          <div className="relative flex-1 min-h-7">
            {domain.ticks.map((tick, i) =>
              tick.label ? (
                <span
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 typo-caption text-foreground uppercase tracking-wider"
                  style={{ left: `${tick.frac * 100}%` }}
                >
                  {tick.label}
                </span>
              ) : null,
            )}
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-px rounded-full border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300"
              style={{ left: `${domain.todayFrac * 100}%` }}
            >
              {dl.progress_today}
            </span>
          </div>
          <div
            className="shrink-0 flex items-center pl-3 border-l border-dashed border-primary/10"
            style={{ width: TRAY_W }}
          >
            <span className="typo-caption text-foreground uppercase tracking-wider truncate">
              {dl.progress_no_date}
            </span>
          </div>
        </div>

        {/* Project rows */}
        {rows.map((row) => {
          const rowH = Math.max(44, row.maxStack * STACK_STEP + 26);
          return (
            <div
              key={row.projectId}
              data-testid={`progress-row-${row.projectId}`}
              className="relative flex items-stretch border-b border-primary/5 last:border-b-0 transition-colors hover:bg-primary/[0.03]"
            >
              <div
                className="shrink-0 px-3 flex flex-col justify-center gap-0.5 min-w-0"
                style={{ width: LEFT_W }}
              >
                <span className="typo-body text-foreground font-medium truncate" title={row.name}>
                  {row.name}
                </span>
                <span className="typo-caption text-foreground tabular-nums">
                  {tx(dl.progress_row_counts, { active: row.activeCount, done: row.doneCount })}
                </span>
              </div>

              <div className="relative flex-1" style={{ minHeight: rowH }}>
                {/* Baseline — anchors the row even where no nodes land. */}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-primary/10 via-primary/[0.07] to-transparent" />
                {row.stacks.map((stack, si) => {
                  const visible = stack.nodes.slice(0, STACK_CAP);
                  const hidden = stack.nodes.length - visible.length;
                  return visible
                    .map((n, ni) => {
                      const offsetY = (ni - (visible.length - 1) / 2) * STACK_STEP;
                      return (
                        <span
                          key={n.goal.id}
                          className="absolute"
                          style={{
                            left: `${n.frac * 100}%`,
                            top: '50%',
                            transform: `translate(-50%, calc(-50% + ${offsetY}px))`,
                          }}
                        >
                          <GoalSquare
                            goal={n.goal}
                            overdue={n.overdue}
                            delay={stagger()}
                            dl={dl}
                            onOpen={openGoal}
                          />
                        </span>
                      );
                    })
                    .concat(
                      hidden > 0
                        ? [
                            <span
                              key={`overflow-${si}`}
                              className="absolute -translate-x-1/2 typo-caption text-foreground tabular-nums"
                              style={{
                                left: `${stack.frac * 100}%`,
                                top: `calc(50% + ${((visible.length - 1) / 2) * STACK_STEP + 8}px)`,
                              }}
                            >
                              +{hidden}
                            </span>,
                          ]
                        : [],
                    );
                })}
              </div>

              <div
                className="shrink-0 flex flex-wrap content-center items-center gap-1.5 pl-3 pr-2 py-2 border-l border-dashed border-primary/10"
                style={{ width: TRAY_W }}
              >
                {row.undated.map((g) => (
                  <GoalSquare
                    key={g.id}
                    goal={g}
                    overdue={false}
                    delay={stagger()}
                    dl={dl}
                    onOpen={openGoal}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {drawer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TEMPORARY prototype switcher — deleted at consolidation. Labels intentionally
// untranslated (throwaway dev scaffold; winner gets proper i18n).
// ---------------------------------------------------------------------------
type ProtoVariant = 'baseline' | 'sequence' | 'buckets';
const PROTO_KEY = 'personas.goals.progress.prototype';

function readProtoVariant(): ProtoVariant {
  try {
    const v = localStorage.getItem(PROTO_KEY);
    return v === 'sequence' || v === 'buckets' ? v : 'baseline';
  } catch (err) {
    silentCatch('GoalsProgress.readProtoVariant')(err);
    return 'baseline';
  }
}

export function GoalsProgress() {
  const [variant, setVariant] = useState<ProtoVariant>(readProtoVariant);
  const change = (v: ProtoVariant) => {
    setVariant(v);
    try {
      localStorage.setItem(PROTO_KEY, v);
    } catch (err) {
      silentCatch('GoalsProgress.persistProtoVariant')(err);
    }
  };
  return (
    <div>
      <div className="mb-3 flex justify-center">
        <SegmentedTabs<ProtoVariant>
          variant="segment"
          fullWidth={false}
          ariaLabel="Prototype variant"
          activeTab={variant}
          onTabChange={change}
          tabs={[
            { id: 'baseline', label: 'Baseline · exact dates' },
            { id: 'sequence', label: 'Sequence · filmstrip' },
            { id: 'buckets', label: 'Buckets · time matrix' },
          ]}
        />
      </div>
      {variant === 'sequence' ? (
        <GoalsProgressSequence />
      ) : variant === 'buckets' ? (
        <GoalsProgressBuckets />
      ) : (
        <GoalsProgressBaseline />
      )}
    </div>
  );
}

export default GoalsProgress;
