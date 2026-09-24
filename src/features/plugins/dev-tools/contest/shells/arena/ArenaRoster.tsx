// The home layer: a compact column of every race beside the track. Refine
// rounds nest under the race they came from. Loading v2: the header always
// renders, a calm delayed ghost fills emptiness, cards ripple in once.
import { useMemo } from 'react';
import { Flag, ListOrdered, Plus, Trophy } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import { contestKeyString, type ContestKey } from '../../focus';
import { phaseLabel, phaseTone } from '../../model/labels';
import { raceRounds } from './arenaModel';
import { ARENA } from './copy';

const GHOST_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32'];
const CARD_H = 76;

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
  const { t } = useTranslation();
  const entries = useMemo(() => raceRounds(contests), [contests]);
  const enter = useRevealTracker('arena-roster');
  const current = trackKey ? contestKeyString(trackKey) : null;
  const showGhost = isLoading && contests.length === 0;

  return (
    <aside className="flex min-h-0 flex-col gap-3" aria-label={ARENA.rosterTitle} data-testid="arena-roster">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-primary" aria-hidden />
          <h3 className="typo-heading flex-1">{ARENA.rosterTitle}</h3>
          <Button size="xs" variant="ghost" icon={<ListOrdered className="w-3.5 h-3.5" />} onClick={onStandings} data-testid="arena-open-standings">
            {ARENA.standings}
          </Button>
        </div>
        <Button size="sm" variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNewRace} data-testid="arena-new-race">
          {ARENA.newRace}
        </Button>
        <p className="typo-caption text-foreground">{ARENA.rosterHint}</p>
      </header>

      {error != null && contests.length === 0 ? (
        <ErrorBanner
          variant="inline"
          message={`${ARENA.rosterLoadFailed} ${resolveErrorTranslated(t, extractMessage(error)).message}`}
          onRetry={onRetry}
        />
      ) : showGhost ? (
        <RosterGhost />
      ) : entries.length === 0 ? (
        <EmptyState icon={Flag} title={ARENA.rosterEmptyTitle} subtitle={ARENA.rosterEmptyBody} action={{ label: ARENA.newRace, onClick: onNewRace, icon: Plus }} />
      ) : (
        <ol className="space-y-1.5 overflow-y-auto pr-1 max-h-[calc(100vh-16rem)]">
          {entries.map(({ summary, depth }, i) => {
            const key = { projectId: summary.projectId, contestId: summary.contestId };
            const id = contestKeyString(key);
            return (
              <RevealItem as="li" key={id} revealId={id} order={i} hasEntered={enter.hasEntered} markEntered={enter.markEntered} style={{ marginLeft: depth * 12 }}>
                <RaceCard summary={summary} active={id === current} onPick={() => onPick(key)} />
              </RevealItem>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function RaceCard({ summary, active, onPick }: { summary: ContestSummary; active: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? 'true' : undefined}
      className={`w-full text-left rounded-card border px-3 py-2 space-y-1 transition-colors focus-ring ${
        active ? 'border-primary/40 bg-primary/10' : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
      data-testid={`arena-race-${summary.contestId}`}
    >
      <div className="flex items-center gap-2">
        <span className="typo-title truncate flex-1">{summary.title}</span>
        <StatusBadge variant={phaseTone(summary.phase)} size="sm" pill>
          {phaseLabel(s, summary.phase)}
        </StatusBadge>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 typo-caption text-foreground">
        <span className="truncate">{summary.projectName}</span>
        {summary.round !== null && <span>· {ARENA.roundN(summary.round)}</span>}
        <span>·</span>
        <RelativeTime timestamp={summary.updatedAtMs} className="typo-caption text-foreground" />
      </div>
      {summary.winner && (
        <div className="flex items-center gap-1.5 typo-caption text-foreground min-w-0">
          <Trophy className="w-3.5 h-3.5 shrink-0 text-status-success" aria-hidden />
          <span className="typo-label">{summary.winner}</span>
          {summary.winnerSeatSpec && <span className="typo-caption font-mono truncate">{ARENA.winnerBy} {summary.winnerSeatSpec}</span>}
        </div>
      )}
    </button>
  );
}

function RosterGhost() {
  return (
    <div className="space-y-1.5" aria-hidden data-testid="arena-roster-ghost">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-card border border-primary/[0.06] px-3 py-2 space-y-2 animate-fade-in"
          style={{ height: CARD_H, animationDelay: `${120 + i * 35}ms` }}
        >
          <div className={`h-3.5 rounded-interactive bg-primary/[0.06] ${GHOST_WIDTHS[i % 4]}`} />
          <div className="h-3 w-24 rounded-interactive bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
