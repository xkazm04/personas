// The rail: who wants a human, in rank order - one issue per row.
//
// A row is the rank and the name, nothing else. The reason lives in the
// tooltip, because six three-line cards stacked in a 320px rail were a wall of
// text nobody could scan; a reader hunting for a place reads names, and reads
// the reason only for the name they stopped on. Picks are grouped under their
// project so "personas" is said once rather than on every row.
//
// Each row still prints the same rank number the canvas paints, so a name read
// here has a findable place over there.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { AttentionPick } from './kpiPicks';
import { moveKind, nextMoveOf, nextMoveText } from './kpiNextMove';
import { KT } from './kpiType';

const KIND_TONE: Record<string, string> = {
  off: 'var(--status-error)',
  dark: 'var(--muted-foreground)',
  stale: 'var(--status-info)',
  unpaced: 'var(--status-warning)',
  settled: 'var(--status-success)',
};

interface PickGroup {
  /** The owning project, or null when the rail is already inside one. */
  context: string | null;
  picks: AttentionPick[];
}

/** Group picks by project, in the order each project first appears in the
 *  ranking - so the group order still says who wants a human first. */
export function groupPicks(picks: AttentionPick[]): PickGroup[] {
  const groups: PickGroup[] = [];
  for (const pick of picks) {
    const last = groups.find((g) => g.context === pick.context);
    if (last) last.picks.push(pick);
    else groups.push({ context: pick.context, picks: [pick] });
  }
  return groups;
}

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
      <h3 className={KT.eyebrow}>{title}</h3>
      {picks.length === 0 ? (
        <p className={KT.meta}>{o.rail_settled}</p>
      ) : (
        <div className="space-y-2.5">
          {groupPicks(picks).map((group) => (
            <div key={group.context ?? 'here'} className="space-y-0.5">
              {group.context && <p className={`px-1.5 pt-1 ${KT.meta}`}>{group.context}</p>}
              <ol className="divide-y divide-primary/10">
                {group.picks.map((pick) => {
                  const move = nextMoveOf(pick.tally);
                  return (
                    <li key={pick.id}>
                      <Tooltip
                        placement="left"
                        content={
                          <span className="block max-w-[18rem] space-y-0.5">
                            <span className={`block ${KT.name}`}>{pick.label}</span>
                            <span className="block typo-caption">
                              {tx(o.rail_counts, { measured: pick.tally.measured, total: pick.tally.total })}
                            </span>
                            <span className="block typo-caption">{nextMoveText(move, t, tx)}</span>
                          </span>
                        }
                      >
                        <button
                          type="button"
                          onClick={() => onOpen(pick)}
                          data-testid={`kpi-rail-${pick.id}`}
                          className="flex w-full items-center gap-2 rounded-interactive px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/30 focus-ring"
                        >
                          <span
                            aria-hidden="true"
                            className="flex size-5 shrink-0 items-center justify-center rounded-full typo-label tabular-nums"
                            style={{ background: KIND_TONE[moveKind(move)], color: 'var(--background)' }}
                          >
                            {pick.rank}
                          </span>
                          <span className={`min-w-0 flex-1 truncate ${KT.text}`}>{pick.label}</span>
                          <span className={`shrink-0 ${KT.metaFigure}`}>
                            {`${pick.tally.measured}/${pick.tally.total}`}
                          </span>
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
