// The home layer: a compact list of every race beside the track, read like
// the notes desk — a title that wraps to two lines, one muted meta line, and
// for a decided race the winner. Refine rounds sit indented under the race
// they came from, on a thin guide line. Loading v2: the header always
// renders, a calm delayed ghost fills emptiness, rows ripple in once.
import { useMemo, type ReactNode } from 'react';
import { ListOrdered, Plus, Trophy } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import { contestKeyString, type ContestKey } from '../focus';
import { phaseLabel, phaseTone } from '../model/labels';
import { raceRounds } from './arenaModel';
import { RefreshFailed } from './RefreshFailed';
import { SeatLabel } from './SeatLabel';
import { ToneDot } from './ToneDot';

const GHOST_WIDTHS = ['w-48', 'w-36', 'w-44', 'w-40'];

export interface ArenaRosterProps {
  contests: ContestSummary[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  trackKey: ContestKey | null;
  onPick: (key: ContestKey) => void;
  onNewRace: () => void;
  onStandings: () => void;
}

export function ArenaRoster({ contests, isLoading, error, onRetry, trackKey, onPick, onNewRace, onStandings }: ArenaRosterProps) {
  const { t, tx } = useTranslation();
  const a = t.plugins.contest.arena;
  const entries = useMemo(() => raceRounds(contests), [contests]);
  const enter = useRevealTracker('arena-roster');
  const current = trackKey ? contestKeyString(trackKey) : null;
  const showGhost = isLoading && contests.length === 0;
  // One project's name repeated on every row is noise; show it only when races span projects.
  const multiProject = useMemo(() => new Set(contests.map((c) => c.projectId)).size > 1, [contests]);

  return (
    <aside className="flex min-h-0 flex-col gap-2" aria-label={a.roster_title} data-testid="arena-roster">
      <header className="flex items-center gap-1.5">
        <h3 className="typo-label flex-1">{a.roster_title}</h3>
        <Button size="xs" variant="ghost" icon={<ListOrdered className="w-3.5 h-3.5" />} onClick={onStandings} data-testid="arena-open-standings">
          {a.standings}
        </Button>
        <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNewRace} data-testid="arena-new-race">
          {a.new_race}
        </Button>
      </header>

      {error != null && contests.length > 0 && (
        <RefreshFailed onRetry={async () => onRetry()} testId="arena-roster-refresh-failed" />
      )}
      {error != null && contests.length === 0 ? (
        <ErrorBanner
          variant="inline"
          message={tx(a.roster_load_failed_detail, { message: resolveErrorTranslated(t, extractMessage(error)).message })}
          onRetry={onRetry}
        />
      ) : showGhost ? (
        <RosterGhost />
      ) : entries.length === 0 ? (
        <EmptyState icon={Trophy} title={a.roster_empty_title} subtitle={a.roster_empty_body} action={{ label: a.new_race, onClick: onNewRace, icon: Plus }} />
      ) : (
        <ol className="-mx-1 overflow-y-auto max-h-[calc(100vh-15rem)]">
          {entries.map(({ summary, depth }, i) => {
            const key = { projectId: summary.projectId, contestId: summary.contestId };
            const id = contestKeyString(key);
            return (
              <RevealItem as="li" key={id} revealId={id} order={i} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
                <div className={depth > 0 ? 'ml-3 border-l border-primary/15 pl-2' : ''}>
                  <RaceRow summary={summary} active={id === current} showProject={multiProject} onPick={() => onPick(key)} />
                </div>
              </RevealItem>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function RaceRow({
  summary,
  active,
  showProject,
  onPick,
}: {
  summary: ContestSummary;
  active: boolean;
  showProject: boolean;
  onPick: () => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? 'true' : undefined}
      className={`relative block w-full rounded-interactive px-2.5 py-1.5 text-left transition-colors focus-ring ${
        active ? 'bg-secondary/50' : 'hover:bg-secondary/25'
      }`}
      data-testid={`arena-race-${summary.contestId}`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-pill bg-primary" aria-hidden />}
      <span className="typo-body text-foreground line-clamp-2 break-words">
        <span className="font-medium">{summary.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 typo-caption">
        <ToneDot tone={phaseTone(summary.phase)}>{phaseLabel(s, summary.phase)}</ToneDot>
        {showProject && <MetaItem>{summary.projectName}</MetaItem>}
        {summary.round !== null && <MetaItem>{tx(a.round_n, { n: summary.round })}</MetaItem>}
        <MetaItem>
          <RelativeTime timestamp={summary.updatedAtMs} className="typo-caption" />
        </MetaItem>
      </span>
      {summary.winner && (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 typo-caption">
          <Trophy className="w-3.5 h-3.5 shrink-0 text-status-success" aria-hidden />
          <span className="sr-only">{a.winner}</span>
          <span className="text-foreground shrink-0">{summary.winner}</span>
          {summary.winnerSeatSpec && <SeatLabel spec={summary.winnerSeatSpec} />}
        </span>
      )}
    </button>
  );
}

/** One "· item" of the meta line; the separator never wraps away from its item. */
function MetaItem({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden>·</span>
      {children}
    </span>
  );
}

function RosterGhost() {
  return (
    <div className="space-y-1" aria-hidden data-testid="arena-roster-ghost">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5 px-2.5 py-2 animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
          <div className={`h-3.5 rounded-interactive bg-primary/[0.06] ${GHOST_WIDTHS[i % 4]}`} />
          <div className="h-3 w-28 rounded-interactive bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
