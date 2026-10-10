/**
 * A watched pipeline as a FIGURE: its Lifecycle rail in miniature. One node
 * per step, in step order, drawn as the project's own rail draws the verdict
 * (Lifecycle's `VERDICT` table): green, at risk and failing are filled in
 * their status ink, not measured is a dashed hollow, stale is dotted and
 * hatched, instructed is a quiet hollow. The two lanes (before and after the
 * task) sit side by side, each as wide as its steps, each a pipe the nodes
 * sit on, with the lane's name above it.
 *
 * Inert: what a reader hears is the verdict count (`role="img"` with the
 * counts in words); the card it sits on is the press target.
 */
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleWatchedStep } from '@/lib/bindings/LifecycleWatchedStep';
import { VERDICT } from '@/features/plugins/dev-tools/sub_lifecycle/lifecycleView/layer1/healthModel';
import '@/features/plugins/dev-tools/sub_lifecycle/lifecycleView/layer1/layer1.css';

import { BY_SEVERITY, lanesOf, verdictTally } from '../watchedModel';

function nodeLook(h: LifecycleHealth): string {
  const v = VERDICT[h];
  if (v.hollow) return `${v.outline} bg-background`;
  // Instructed: nothing measures it, so a quiet ring rather than the rail card's faint outline.
  if (h === 'instructed') return 'border-2 border-primary/35 bg-background';
  if (v.hatched) return `${v.outline} bg-background ${v.wash}`;
  return `${v.outline} ${v.fill}`;
}

function Lane({ name, steps }: { name: string; steps: LifecycleWatchedStep[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" style={{ flexGrow: Math.max(1, steps.length), flexBasis: 0 }}>
      <span className="typo-eyebrow text-primary">{name}</span>
      <span className="relative flex h-4 items-center justify-between">
        <span aria-hidden className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 rounded-pill bg-primary/20" />
        {steps.map((s) => (
          <span
            key={s.stepId}
            aria-hidden
            className={`relative block h-4 w-4 shrink-0 rounded-full ${nodeLook(s.health)}`}
            data-node={s.stepId}
            data-health={s.health}
          />
        ))}
      </span>
    </div>
  );
}

/** The verdict counts in words, worst first, zero counts left out. */
export function useVerdictWords() {
  const { t, tx } = useTranslation();
  const d = t.director;
  const word: Record<LifecycleHealth, string> = {
    red: d.lcx9_count_red,
    amber: d.lcx9_count_amber,
    stale: d.lcx9_count_stale,
    unmeasured: d.lcx9_count_unmeasured,
    green: d.lcx9_count_green,
    instructed: d.lcx9_count_instructed,
  };
  return (steps: readonly LifecycleWatchedStep[]): string[] => {
    const tally = verdictTally(steps);
    return BY_SEVERITY.filter((h) => tally[h] > 0).map((h) => tx(word[h], { count: tally[h] }));
  };
}

export function PipelineMiniRail({ steps }: { steps: LifecycleWatchedStep[] }) {
  const { t, tx } = useTranslation();
  const d = t.director;
  const words = useVerdictWords();
  const { before, after } = lanesOf(steps);
  return (
    <div
      role="img"
      aria-label={tx(d.lcx9_rail_label, { counts: words(steps).join(', ') })}
      className="flex items-end gap-5"
      data-testid="watched-mini-rail"
    >
      {before.length > 0 && <Lane name={d.lcx9_lane_before} steps={before} />}
      {after.length > 0 && <Lane name={d.lcx9_lane_after} steps={after} />}
    </div>
  );
}
