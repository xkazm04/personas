// The Activity destination: the fleet board with the persona drawer and the
// remote-session drawer layered over it.

import { Suspense } from 'react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { lazyRetry } from '@/lib/lazyRetry';
import type { MonitorData } from '../useMonitorData';
import { MonitorDrawerShell } from '../MonitorDrawerShell';
import { FleetGridView } from '../grid/FleetGridView';
import type { StreamTeam } from '../channels/types';
import type { PersonaCardModel } from '../monitorModel';
import type { MonitorSelection } from './useMonitorSelection';
import { SurfaceFallback } from './fallbacks';

// Not on screen when the Monitor opens onto Activity, and the heaviest chunk
// of all (366 modules, capabilities + reasoning trace): fetched the first time
// a drawer opens. See MonitorBody for the chunk boundaries.
const MonitorDrawer = lazyRetry(() => import('../MonitorDrawer').then((m) => ({ default: m.MonitorDrawer })));
const RemoteSessionDrawer = lazyRetry(() => import('../remote/RemoteSessionDrawer'));

export function ActivityBody({ data, cards, personas, teams, feedTeams, selection: s, now, onOpenSpeaker }: {
  data: MonitorData;
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  feedTeams: StreamTeam[];
  selection: MonitorSelection;
  now: number;
  onOpenSpeaker: (teamId: string, personaId: string) => void;
}) {
  // The drawer owns its own review/message writes (`drawer/useDrawerData`),
  // so the Monitor hands it only the busy hint and the badge refresh.
  const { loading, isProcessing, refreshAttention } = data;

  return (
    <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
      {/* Same wrapper the channel surfaces get — the Activity board is a
          card on the Monitor surface (`.monitor-surface`, painted once at
          the overlay root), not a bare grid on the page background (see
          FleetGridView's consolidation header).

          TWO elements, not one, and that is load-bearing: the OUTER
          `absolute inset-0` is the only thing bounding the board's height.
          The inner padded div used to carry `.hud-atmosphere`, whose
          `position: relative` lives in globals.css, UNLAYERED, and so beats
          Tailwind's `@layer utilities` `absolute` whatever the class order.
          Putting both on one div silently demoted the wrapper to
          `relative`, nothing bounded the board, and the columns grew to
          10,505px inside a 975px overlay. That class is gone, the rule
          stays: never put a globals.css class on the bounding wrapper. */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="h-full p-2">
          {/* First-ever cold open only (the warm cache in useMonitorData
              makes every re-open paint the last-known fleet immediately):
              the board renders its OWN chrome — header, usage strip, rail
              footprint — with a geometry-matched ghost where the columns
              will be, never a settled empty state before the first read
              lands (law 1 / law 3). */}
          <FleetGridView
            cards={cards}
            personas={personas}
            teams={teams}
            selectedPersonaId={s.selection?.personaId ?? null}
            onSelect={s.handleCardSelect}
            feedTeams={feedTeams}
            onOpenSpeaker={onOpenSpeaker}
            isLoading={loading && cards.length === 0}
            onOpenRemote={s.openRemote}
          />
        </div>
      </div>

      <MonitorDrawerShell open={!!(s.selectedCard && s.selection)} onClose={s.closeDrawer}>
        {s.selectedCard && s.selection && (
          <Suspense fallback={<SurfaceFallback />}>
            <MonitorDrawer
              card={s.selectedCard}
              initialSection={s.selection.section}
              designContext={s.selectedPersona?.design_context ?? null}
              isProcessing={isProcessing}
              now={now}
              onAttentionChanged={refreshAttention}
              onClose={s.closeDrawer}
            />
          </Suspense>
        )}
      </MonitorDrawerShell>
      {/* A session sent to a paired device: same shell, its own content. */}
      <MonitorDrawerShell open={s.remoteJobId !== null} onClose={s.closeRemote}>
        {s.remoteJobId !== null && (
          <Suspense fallback={<SurfaceFallback />}>
            <RemoteSessionDrawer jobId={s.remoteJobId} onClose={s.closeRemote} />
          </Suspense>
        )}
      </MonitorDrawerShell>
    </div>
  );
}
