// LeaderboardSection — the Leaderboard tab's scorecard matrix (its one best
// section) hosted as a standalone Mission Control section (2026-08-25
// monitoring consolidation). Data comes from the same healthSignals-derived
// leaderboard the tab used; the section auto-loads health data once on an
// idle slot if the store is cold.

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useLeaderboardData } from '@/features/overview/sub_leaderboard/libs/useLeaderboardData';
import { LeaderboardMatrixView, LeaderboardMatrixPlaceholder } from '@/features/overview/sub_leaderboard/components/LeaderboardMatrixView';
import { PaneHeader } from '../PaneHeader';

/**
 * Renders nothing until the fleet has ≥2 ranked agents — a one-row matrix is
 * noise, and the empty/single-agent story is already told by the Vitals pane.
 */
export function LeaderboardSection() {
  const { t, tx } = useTranslation();
  const { leaderboard, loading, isEmpty, fleetAvgScore, fleetBenchmark, refresh } = useLeaderboardData();

  // One-shot idle auto-load when the health store is cold. Attempted-guard:
  // an empty fleet (or persistently failing health compute) still ends with
  // isEmpty true after the refresh, so without it this would re-schedule
  // refresh() forever.
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
        label={t.overview.leaderboard.title}
        subtitle={leaderboard.length > 1
          ? tx(t.overview.leaderboard.section_subtitle, { count: leaderboard.length, avg: fleetAvgScore })
          : undefined}
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
