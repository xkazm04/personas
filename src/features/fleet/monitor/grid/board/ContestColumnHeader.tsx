// ContestColumnHeader — a contest column's header, and the Monitor's way back
// to the race.
//
// The contest page links INTO the Monitor ("Watch in Monitor"); this header is
// the reverse door. A contest is (project, contest) — arenas are per project
// and ids are per arena — so the header opens exactly the contest its seats
// belong to through the feeder's own door (`openContest`), and names it by its
// title from the contest list cache (warmed at boot by `ContestLiveFeeder`),
// falling back to the id while the cache does not know it.
//
// A seat labelled before the project joined its run label cannot say which
// arena it belongs to. Its column still groups, by the id alone, but the
// header is inert and its tooltip says why.

import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import { useTranslation } from '@/i18n/useTranslation';
import { openContest } from '@/features/plugins/dev-tools/contest/ContestLiveFeeder';
import { contestListSlots } from '@/features/plugins/dev-tools/contest/hooks/contestStore';

/** The contest's title from the list cache, or `null` while it does not know
 *  it. With no project the id is ambiguous, so it answers only when exactly
 *  one listed contest carries that id. */
function useContestTitle(projectId: string | null, contestId: string): string | null {
  const rows = useModuleSubscription(contestListSlots, 'all')?.data ?? null;
  return useMemo(() => {
    if (!rows) return null;
    const matches = rows.filter((r) => r.contestId === contestId && (projectId === null || r.projectId === projectId));
    return matches.length === 1 ? matches[0]!.title || null : null;
  }, [rows, projectId, contestId]);
}

export function ContestColumnHeader({ projectId, contestId, seats }: {
  /** `null` for seats labelled before the project joined the run label. */
  projectId: string | null;
  contestId: string;
  /** Session rows in the column. */
  seats: number;
}) {
  const { t, tx } = useTranslation();
  const title = useContestTitle(projectId, contestId);
  const name = title ?? contestId;
  const linked = projectId !== null;

  return (
    <Tooltip
      content={linked
        ? tx(t.monitor.grid_column_contest_open, { contest: name })
        : tx(t.monitor.grid_column_contest_unlinked, { contest: name })}
      triggerFocusable={!linked}
      triggerClassName="flex w-full"
    >
      <button
        type="button"
        disabled={!linked}
        onClick={() => { if (projectId) openContest({ projectId, contestId }); }}
        data-testid="fleet-grid-column-header"
        data-contest-id={contestId}
        data-contest-project-id={projectId ?? undefined}
        className="focus-ring flex w-full items-baseline gap-1.5 rounded-interactive px-1 py-0.5 text-left text-foreground transition-colors hover:bg-secondary/40 disabled:is-disabled"
      >
        <Trophy className="h-3 w-3 flex-shrink-0 self-center opacity-60" aria-hidden />
        <span className="min-w-0 flex-1 truncate typo-label">{name}</span>
        <span className="flex-shrink-0 typo-caption tabular-nums opacity-50">{seats}</span>
      </button>
    </Tooltip>
  );
}
