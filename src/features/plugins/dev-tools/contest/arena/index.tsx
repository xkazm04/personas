// Arena — contests as races (prototype shell, WP5a).
//
// Layers, simplest first:
//   centre  the race on the track: one lane per seat (grid → racing → outcome),
//           variants landing in their lane, the finish-line strip beyond;
//   beside  a compact column of every race (the home), "New race" on top;
//   above   the photo finish (full-screen review lightbox), the New race
//           drawer (setup) and the Standings drawer (ledger + seat stats).
// Takes no props: it reads the contest hooks and `contest/focus.ts`.
import { useState } from 'react';

import { useSystemStore } from '@/stores/systemStore';

import { useContests } from '../hooks/useContests';
import { pickTrackKey } from './arenaModel';
import { ArenaRoster } from './ArenaRoster';
import { ArenaStage } from './ArenaStage';
import { SetupDrawer } from './SetupDrawer';
import { StandingsDrawer } from './StandingsDrawer';
import { useArenaFocus } from './useArenaFocus';

type Drawer = 'setup' | 'standings' | null;

export default function ArenaShell() {
  const list = useContests();
  const { focused, reviewKey, setReviewKey, pick } = useArenaFocus(list.contests);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const trackKey = pickTrackKey(focused, list.contests);

  return (
    <div className="grid gap-6 typo-body lg:grid-cols-[19rem_minmax(0,1fr)]" data-testid="contest-shell-arena">
      <ArenaRoster
        contests={list.contests}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refresh()}
        trackKey={trackKey}
        onPick={pick}
        onNewRace={() => setDrawer('setup')}
        onStandings={() => setDrawer('standings')}
      />
      <div className="min-w-0">
        <ArenaStage trackKey={trackKey} reviewKey={reviewKey} onReviewKey={setReviewKey} onNewRace={() => setDrawer('setup')} />
      </div>

      {drawer === 'setup' && (
        <SetupDrawer defaultProjectId={focused?.projectId ?? activeProjectId ?? null} onClose={() => setDrawer(null)} />
      )}
      {drawer === 'standings' && (
        <StandingsDrawer
          contests={list.contests}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refresh()}
          onPick={(key) => {
            pick(key);
            setDrawer(null);
          }}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
