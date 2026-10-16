// The Monitor's body: the one destination the router has on screen, behind ONE
// Suspense boundary (see `BodyFallback`).

import { Suspense, type ComponentProps } from 'react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { lazyRetry } from '@/lib/lazyRetry';
import { useTranslation } from '@/i18n/useTranslation';
import type { MonitorView } from './monitorRouter';
import { ActivityBody } from './ActivityBody';
import { BodyFallback } from './fallbacks';

// THE CHUNK BOUNDARIES SIT ONE LEVEL DEEPER THAN THE MONITOR.
//
// Measured 2026-09-06 by walking static imports from PersonaMonitor: 551
// modules, against the ~90 the app shell already holds. Almost all of the rest
// hangs off five components that are not on screen when the Monitor opens onto
// Activity — the drawer (366 modules, capabilities + reasoning trace; see
// ActivityBody), the channel surfaces (235–248 each), and the dispatch dock
// (117). Each is its own chunk now, fetched the first time it is needed,
// behind a fallback that holds its exact footprint: the dock's 36px bar, the
// channel card's header ghost, nothing for a drawer that has not been opened.
// The Activity board itself keeps only what it paints in frame one. The
// Blueprint picker (2026-10-16) is a chunk of its own on the same terms.
const ConversationBriefing = lazyRetry(() =>
  import('../channels/ConversationBriefing').then((m) => ({ default: m.ConversationBriefing })),
);
const ChannelMap = lazyRetry(() => import('../channels/map/ChannelMap'));
const BlueprintPicker = lazyRetry(() => import('@/features/decision-center/lens/BlueprintPicker'));

type ActivityProps = ComponentProps<typeof ActivityBody>;

export function MonitorBody({ view, activity, hasChannels, bridges, channelPreset }: {
  view: MonitorView;
  /** Everything Activity draws; `feedTeams`, `personas` and the drill-in also serve the channel surfaces. */
  activity: ActivityProps;
  hasChannels: boolean;
  bridges: ComponentProps<typeof ConversationBriefing>['bridges'];
  channelPreset: ComponentProps<typeof ConversationBriefing>['preset'];
}) {
  return (
    <Suspense fallback={<BodyFallback />}>
      {view === 'activity' ? (
        <ActivityBody {...activity} />
      ) : view === 'blueprint' ? (
        /* The lens-scan products; a tile opens its blueprint over the app
           (LensSheetHost). Escape at the drawing's site closes only the
           drawing and lands back here (see useMonitorEscape). No inset: the
           list is a bp surface that paints its own ground and double frame
           edge to edge. */
        <div className="relative z-10 flex-1 min-h-0 overflow-y-auto">
          <div className="h-full">
            <BlueprintPicker />
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex-1 min-h-0">
          <div className="h-full p-2">
            {!hasChannels ? (
              <NoTeams />
            ) : view === 'map' ? (
              <ChannelMap teams={activity.feedTeams} onDrillIn={activity.onOpenSpeaker} />
            ) : (
              <ConversationBriefing
                teams={activity.feedTeams}
                personas={activity.personas}
                bridges={bridges}
                preset={channelPreset}
              />
            )}
          </div>
        </div>
      )}
    </Suspense>
  );
}

/** No team to hold a channel yet: the shared empty state, on the chat motif. */
function NoTeams() {
  const { t } = useTranslation();
  return <ScenarioEmptyState className="h-full justify-center" art="chat" size="sm" title={t.monitor.channels_no_teams} />;
}
