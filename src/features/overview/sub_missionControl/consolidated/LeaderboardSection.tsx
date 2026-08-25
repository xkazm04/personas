// Prototype variant piece — "Consolidated Mission Control".
//
// The Leaderboard tab's scorecard matrix (its one best section) hosted as a
// standalone Mission Control section. Data comes from the same healthSignals-
// derived leaderboard the tab uses; the section auto-loads health data once
// on an idle slot if the store is cold, exactly like LeaderboardPage does.
//
// Copy is prototype-local (same convention as the Mission Control baseline);
// extracted to i18n at consolidation.

import { useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useLeaderboardData } from '@/features/overview/sub_leaderboard/libs/useLeaderboardData';
import { LeaderboardMatrixView, LeaderboardMatrixPlaceholder } from '@/features/overview/sub_leaderboard/components/LeaderboardMatrixView';
import { PaneHeader } from '../PaneHeader';

const COPY = {
  pane: 'LEADERBOARD',
  agents: 'agents',
  fleetAvg: 'fleet avg',
};

/**
 * Renders nothing until the fleet has ≥2 ranked agents — a one-row matrix is
 * noise, and the empty/single-agent narratives stay on the dedicated tab.
 */
export function LeaderboardSection() {
  const { leaderboard, loading, isEmpty, fleetAvgScore, fleetBenchmark, refresh } = useLeaderboardData();

  // One-shot idle auto-load when the health store is cold (mirrors
  // LeaderboardPage — see its comment on the attempted-guard).
  const autoLoadAttemptedRef = useRef(false);
  useEffect(() => {
    if (!isEmpty || loading || autoLoadAttemptedRef.current) return;
    autoLoadAttemptedRef.current = true;

    const run = () => void refresh();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const handle = setTimeout(run, 200);
    return () => clearTimeout(handle);
  }, [isEmpty, loading, refresh]);

  const handleNavigateToAgent = useCallback((personaId: string) => {
    useSystemStore.getState().setSidebarSection('personas');
    useAgentStore.getState().selectPersona(personaId);
  }, []);

  if (!loading && leaderboard.length < 2) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader
        label={COPY.pane}
        subtitle={leaderboard.length > 1 ? `${leaderboard.length} ${COPY.agents} · ${COPY.fleetAvg} ${fleetAvgScore}` : undefined}
      />
      <div className="p-3">
        {loading && leaderboard.length === 0 ? (
          <LeaderboardMatrixPlaceholder />
        ) : (
          <LeaderboardMatrixView
            leaderboard={leaderboard}
            fleetBenchmark={fleetBenchmark}
            fleetAvgScore={fleetAvgScore}
            onNavigateToAgent={handleNavigateToAgent}
          />
        )}
      </div>
    </div>
  );
}
