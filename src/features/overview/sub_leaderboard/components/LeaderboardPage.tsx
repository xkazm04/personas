import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Trophy, RefreshCw, Users } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import Button from '@/features/shared/components/buttons/Button';
import { useLeaderboardData, type LeaderboardEntry } from '../libs/useLeaderboardData';
import { LeaderboardCard } from './LeaderboardCard';
import { ScoreRadar } from './ScoreRadar';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const { leaderboard, loading, isEmpty, fleetAvgScore, refresh } = useLeaderboardData();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-load health data on first visit if empty
  useEffect(() => {
    if (isEmpty && !loading) {
      const run = () => void refresh();
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(run, { timeout: 2000 });
        return () => cancelIdleCallback(id);
      }
      const t = setTimeout(run, 200);
      return () => clearTimeout(t);
    }
  }, []);

  const handleCardClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleNavigateToAgent = useCallback((personaId: string) => {
    useSystemStore.getState().setSidebarSection('personas');
    useAgentStore.getState().selectPersona(personaId);
  }, []);

  const selectedEntry = leaderboard.find((e) => e.personaId === selectedId) ?? null;
  const topEntry = leaderboard[0] ?? null;
  const radarEntries: LeaderboardEntry[] = [];
  if (selectedEntry) radarEntries.push(selectedEntry);
  else if (topEntry) radarEntries.push(topEntry);

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
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                  {leaderboard.length} agents
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Fleet avg: {fleetAvgScore}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              loading={loading}
              onClick={() => void refresh()}
              aria-label="Refresh leaderboard"
              title="Refresh leaderboard"
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
            <p className="text-sm text-muted-foreground/60">Computing agent scores...</p>
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState />
        ) : leaderboard.length === 1 ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <SingleAgentView entry={leaderboard[0]!} />
          </div>
        ) : (
          <div className="flex gap-6 max-w-5xl mx-auto">
            {/* Left: ranked list */}
            <div className="flex-1 space-y-2 min-w-0">
              {leaderboard.map((entry) => (
                <LeaderboardCard
                  key={entry.personaId}
                  entry={entry}
                  selected={selectedId === entry.personaId}
                  onClick={() => handleCardClick(entry.personaId)}
                  onNavigateToAgent={handleNavigateToAgent}
                />
              ))}
            </div>

            {/* Right: radar + detail */}
            <div className="w-64 flex-shrink-0 space-y-4">
              <div className="p-4 rounded-xl border border-primary/[0.08] bg-secondary/[0.03]">
                <h4 className="text-xs font-medium text-muted-foreground/60 mb-3 text-center">
                  {selectedEntry ? selectedEntry.personaName : 'Top Agent'}
                </h4>
                <div className="flex justify-center">
                  <ScoreRadar entries={radarEntries} size={200} />
                </div>
                {selectedEntry && (
                  <div className="mt-3 space-y-1.5">
                    <StatRow label="Total runs" value={String(selectedEntry.totalExecutions)} />
                    <StatRow label="Recent (7d)" value={String(selectedEntry.recentExecutions)} />
                    <StatRow label="Success" value={`${selectedEntry.successRate.toFixed(1)}%`} />
                    <StatRow label="Avg latency" value={selectedEntry.avgLatencyMs > 0 ? `${(selectedEntry.avgLatencyMs / 1000).toFixed(1)}s` : '—'} />
                    <StatRow label="Daily burn" value={selectedEntry.dailyBurnRate > 0 ? `$${selectedEntry.dailyBurnRate.toFixed(3)}` : '—'} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Trophy className="w-10 h-10 text-muted-foreground/15" />
      <p className="text-sm font-medium text-muted-foreground/60">No agent data yet</p>
      <p className="text-xs text-muted-foreground/40 max-w-sm text-center">
        Run some agents to see performance rankings. The leaderboard needs execution
        history and health data to compute scores.
      </p>
    </div>
  );
}

function SingleAgentView({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Users className="w-8 h-8 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground/50">
        Add more agents to see rankings. Currently only <strong className="text-foreground/70">{entry.personaName}</strong> has data.
      </p>
      <div className="flex justify-center">
        <ScoreRadar entries={[entry]} size={220} />
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground/50">{label}</span>
      <span className="text-foreground/70 font-medium">{value}</span>
    </div>
  );
}
