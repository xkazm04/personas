import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Trophy, RefreshCw } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import Button from '@/features/shared/components/buttons/Button';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useLeaderboardData } from '../libs/useLeaderboardData';
import { rankBy, RANK_OPTIONS, type RankKey } from '../libs/leaderboardRanking';
import { LeaderboardCard } from './LeaderboardCard';
import { Podium } from './Podium';
import { DetailPanel } from './DetailPanel';
import { EmptyState, SingleAgentView } from './EmptyStates';
import { DebtText, debtText } from '@/i18n/DebtText';


export default function LeaderboardPage() {
  const { t } = useTranslation();
  const { leaderboard, loading, isEmpty, fleetAvgScore, fleetBenchmark, refresh } = useLeaderboardData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rankKey, setRankKey] = useState<RankKey>('overall');

  const ranked = useMemo(() => rankBy(leaderboard, rankKey), [leaderboard, rankKey]);
  const rankTabs = useMemo(
    () => RANK_OPTIONS.map((opt) => ({ id: opt.key, label: t.overview.leaderboard[opt.labelKey] })),
    [t],
  );
  const activeDimLabel = rankKey === 'overall'
    ? null
    : t.overview.leaderboard[RANK_OPTIONS.find((o) => o.key === rankKey)!.labelKey];

  // Auto-load health data on first visit if empty
  useEffect(() => {
    if (!isEmpty || loading) return;

    const run = () => void refresh();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }

    const handle = setTimeout(run, 200);
    return () => clearTimeout(handle);
  }, [isEmpty, loading, refresh]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleNavigateToAgent = useCallback((personaId: string) => {
    useSystemStore.getState().setSidebarSection('personas');
    useAgentStore.getState().selectPersona(personaId);
  }, []);

  const topEntry = ranked[0] ?? null;
  const selectedEntry = selectedId
    ? ranked.find((e) => e.personaId === selectedId) ?? null
    : topEntry;
  const podiumEntries = ranked.slice(0, 3);
  const listEntries = ranked.slice(3);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Trophy className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.leaderboard.title}
        subtitle={t.overview.leaderboard.subtitle}
        actions={
          <div className="flex items-center gap-3">
            {leaderboard.length > 0 && (
              <div className="flex items-center gap-2 typo-caption">
                <StatusBadge variant="info">{leaderboard.length} agents</StatusBadge>
                <StatusBadge accent="amber"><DebtText k="auto_fleet_avg_ca5a5f1f" /> {fleetAvgScore}</StatusBadge>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              loading={loading}
              onClick={() => void refresh()}
              aria-label={debtText("auto_refresh_leaderboard_c53e47fb")}
              title={debtText("auto_refresh_leaderboard_c53e47fb")}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <ContentBody centered>
        {loading && leaderboard.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <LoadingSpinner size="lg" />
            <p className="typo-body text-foreground"><DebtText k="auto_computing_agent_scores_b273d5b0" /></p>
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState />
        ) : leaderboard.length === 1 ? (
          <SingleAgentView entry={leaderboard[0]!} />
        ) : (
          <div className="flex flex-col gap-8 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="typo-caption text-foreground">{t.overview.leaderboard.rank_by}</span>
              <SegmentedTabs
                tabs={rankTabs}
                activeTab={rankKey}
                onTabChange={setRankKey}
                variant="pill"
                fullWidth={false}
                ariaLabel={t.overview.leaderboard.rank_by}
              />
            </div>

            <Podium entries={podiumEntries} selectedId={selectedId} onSelect={handleSelect} rankKey={rankKey} activeDimLabel={activeDimLabel} />

            {listEntries.length > 0 ? (
              <div className="flex gap-6">
                <div className="flex-1 space-y-2 min-w-0">
                  {listEntries.map((entry, idx) => (
                    <LeaderboardCard
                      key={entry.personaId}
                      entry={entry}
                      selected={selectedId === entry.personaId}
                      onClick={() => handleSelect(entry.personaId)}
                      onNavigateToAgent={handleNavigateToAgent}
                      index={idx}
                      rankKey={rankKey}
                    />
                  ))}
                </div>
                <div className="w-64 flex-shrink-0">
                  <DetailPanel entry={selectedEntry} onNavigateToAgent={handleNavigateToAgent} fleetBenchmark={fleetBenchmark} />
                </div>
              </div>
            ) : (
              <div className="max-w-sm mx-auto w-full">
                <DetailPanel entry={selectedEntry} onNavigateToAgent={handleNavigateToAgent} fleetBenchmark={fleetBenchmark} />
              </div>
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
