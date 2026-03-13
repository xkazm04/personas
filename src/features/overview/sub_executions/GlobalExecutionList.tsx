import { useEffect, useState, useMemo } from 'react';
import { Loader2, RefreshCw, BarChart3 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { ExecutionMetricsDashboard } from './ExecutionMetricsDashboard';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions/detail/ExecutionDetail';
import type { GlobalExecution } from '@/lib/types/types';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { ExecutionTable } from './ExecutionTable';
import { ExecutionEmptyState } from './ExecutionEmptyStates';

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All', running: 'Running', completed: 'Completed', failed: 'Failed',
};

export default function GlobalExecutionList() {
  const globalExecutions = useOverviewStore((s) => s.globalExecutions);
  const globalExecutionsTotal = useOverviewStore((s) => s.globalExecutionsTotal);
  const globalExecutionsOffset = useOverviewStore((s) => s.globalExecutionsOffset);
  const globalExecutionsWarning = useOverviewStore((s) => s.globalExecutionsWarning);
  const fetchGlobalExecutions = useOverviewStore((s) => s.fetchGlobalExecutions);
  const personas = useAgentStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const { selectedPersonaId, setSelectedPersonaId } = useOverviewFilters();
  const [selectedExec, setSelectedExec] = useState<GlobalExecution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  const personaFiltered = useMemo(() => {
    if (!selectedPersonaId) return globalExecutions;
    return globalExecutions.filter((e) => e.persona_id === selectedPersonaId);
  }, [globalExecutions, selectedPersonaId]);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: personaFiltered.length, running: 0, completed: 0, failed: 0 };
    for (const exec of personaFiltered) {
      if (exec.status === 'running' || exec.status === 'pending') counts.running++;
      else if (exec.status === 'completed') counts.completed++;
      else if (exec.status === 'failed') counts.failed++;
    }
    return counts;
  }, [personaFiltered]);

  const filteredExecutions = useMemo(() => {
    if (filter === 'all') return personaFiltered;
    return personaFiltered.filter((e) =>
      filter === 'running' ? e.status === 'running' || e.status === 'pending' : e.status === filter,
    );
  }, [personaFiltered, filter]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try { await fetchGlobalExecutions(true, filter === 'all' ? undefined : filter); }
      finally { if (active) setIsLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [filter, fetchGlobalExecutions]);

  const hasRunning = useMemo(
    () => globalExecutions.some((e) => e.status === 'running' || e.status === 'pending'),
    [globalExecutions]
  );

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => {
      fetchGlobalExecutions(true, filter === 'all' ? undefined : filter);
    }, 5000);
    return () => clearInterval(id);
  }, [hasRunning, filter, fetchGlobalExecutions]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await fetchGlobalExecutions(true, filter === 'all' ? undefined : filter); }
    finally { setIsRefreshing(false); }
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Loader2 className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Executions"
        subtitle={`${globalExecutionsTotal} execution${globalExecutionsTotal !== 1 ? 's' : ''} recorded`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setShowDashboard(!showDashboard)}
              className={showDashboard ? 'text-blue-400 bg-blue-500/15 border border-blue-500/25' : ''}
              title={showDashboard ? 'Show execution list' : 'Show metrics dashboard'}>
              <BarChart3 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleRefresh} disabled={isRefreshing} title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        }
      />

      {showDashboard ? (
        <ContentBody flex>
          <ExecutionMetricsDashboard onClose={() => setShowDashboard(false)} />
        </ContentBody>
      ) : (
        <>
          <FilterBar<FilterStatus>
            options={(['all', 'running', 'completed', 'failed'] as FilterStatus[]).map((id) => ({
              id, label: FILTER_LABELS[id], badge: statusCounts[id],
            }))}
            value={filter} onChange={setFilter} badgeStyle="paren" layoutIdPrefix="execution-filter"
            trailing={<PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />}
            summary={`Showing ${filteredExecutions.length} of ${globalExecutionsTotal}`}
          />
          {globalExecutionsWarning && (
            <div className="mx-4 md:mx-6 mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-300/90" role="status" aria-live="polite">
              {globalExecutionsWarning}
            </div>
          )}
          <ContentBody flex>
            {isLoading ? (
              <ExecutionEmptyState type="loading" />
            ) : filteredExecutions.length === 0 ? (
              <ExecutionEmptyState type={personas.length === 0 ? 'no-agents' : 'no-executions'} />
            ) : (
              <ExecutionTable
                executions={filteredExecutions}
                hasMore={globalExecutionsOffset < globalExecutionsTotal}
                onLoadMore={() => fetchGlobalExecutions(false, filter === 'all' ? undefined : filter)}
                onSelect={setSelectedExec}
              />
            )}
          </ContentBody>
        </>
      )}

      {selectedExec && (
        <DetailModal title={`${selectedExec.persona_name || 'Unknown'} - Execution`} subtitle={`ID: ${selectedExec.id}`} onClose={() => setSelectedExec(null)}>
          <ExecutionDetail execution={selectedExec} />
        </DetailModal>
      )}
    </ContentBox>
  );
}
