import { useState, useEffect, useCallback, useMemo } from 'react';
import { Swords, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { listCompetitions } from '@/api/devTools/devTools';
import { CompetitionCard } from './CompetitionCard';
import { StrategyLeaderboard } from './StrategyLeaderboard';
import { NewCompetitionModal } from './NewCompetitionModal';
import type { DevCompetition } from '@/lib/bindings/DevCompetition';

export function CompetitionList() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const [competitions, setCompetitions] = useState<DevCompetition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const list = await listCompetitions(activeProjectId);
      setCompetitions(list);
    } catch {
      setCompetitions([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'running' || c.status === 'awaiting_review'),
    [competitions],
  );
  const pastCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'resolved' || c.status === 'cancelled'),
    [competitions],
  );

  if (!activeProjectId) {
    return (
      <div className="rounded-card border border-primary/15 bg-card/30 p-4">
        <p className="typo-body text-foreground">Select a project to see competitions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="typo-caption text-primary uppercase tracking-wider">
          Competitions {competitions.length > 0 && <span>({competitions.length})</span>}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={refresh}
          >
            Refresh
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowNewModal(true)}
          >
            New Competition
          </Button>
        </div>
      </div>

      {competitions.length === 0 && !loading && (
        <div className="rounded-card border border-primary/10 bg-card/20 p-6 text-center">
          <Swords className="w-8 h-8 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">
            No competitions yet. Start one to have 2-4 Dev Clone variants race on the same task in parallel worktrees.
          </p>
        </div>
      )}

      {/* Strategy leaderboard */}
      <StrategyLeaderboard projectId={activeProjectId} />

      {activeCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">Active</p>
          {activeCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} />
          ))}
        </div>
      )}

      {pastCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">Past</p>
          {pastCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} />
          ))}
        </div>
      )}

      <NewCompetitionModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        projectId={activeProjectId}
        onCreated={refresh}
        previousWinnerGenes={null}
      />
    </div>
  );
}
