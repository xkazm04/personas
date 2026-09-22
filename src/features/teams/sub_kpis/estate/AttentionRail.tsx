// The rail: who wants a human, in rank order, with the reason in a sentence.
//
// Each row prints the same rank number the canvas paints, so a name read here
// has a findable place over there. The sentence is the whole point of the row
// — a list of names ranked by a score nobody can see is a list of names.
import { useTranslation } from '@/i18n/useTranslation';

import type { AttentionPick } from './kpiPicks';
import { moveKind, nextMoveOf, nextMoveText } from './kpiNextMove';

const KIND_TONE: Record<string, string> = {
  off: 'var(--status-error)',
  dark: 'var(--muted-foreground)',
  stale: 'var(--status-info)',
  unpaced: 'var(--status-warning)',
  settled: 'var(--status-success)',
};

export function AttentionRail({
  picks,
  title,
  onOpen,
}: {
  picks: AttentionPick[];
  title: string;
  onOpen: (pick: AttentionPick) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="typo-heading text-foreground">{title}</h3>
      {picks.length === 0 ? (
        <p className="typo-caption text-foreground">{o.rail_settled}</p>
      ) : (
        <ol className="space-y-1.5">
          {picks.map((pick) => {
            const move = nextMoveOf(pick.tally);
            return (
              <li key={pick.id}>
                <button
                  type="button"
                  onClick={() => onOpen(pick)}
                  data-testid={`kpi-rail-${pick.id}`}
                  className="flex w-full gap-2.5 rounded-card border border-card-border bg-secondary/10 p-2.5 text-left transition-colors hover:bg-secondary/30 focus-ring"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full typo-label tabular-nums"
                    style={{ background: KIND_TONE[moveKind(move)], color: 'var(--background)' }}
                  >
                    {pick.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block typo-title text-foreground">
                      {pick.label}
                      {pick.context && (
                        <span className="typo-caption text-foreground">{` · ${pick.context}`}</span>
                      )}
                    </span>
                    <span className="block typo-caption text-foreground">
                      {tx(o.rail_counts, { measured: pick.tally.measured, total: pick.tally.total })}
                    </span>
                    <span className="block typo-caption text-foreground">{nextMoveText(move, t, tx)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
