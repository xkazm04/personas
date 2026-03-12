import { useEffect, useState, useMemo } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, X } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getKnowledgeSummary, listExecutionKnowledge } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { OverviewStatCard } from '@/features/overview/sub_observability/OverviewStatCard';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { KNOWLEDGE_TYPES } from './knowledgeTypes';
import { KnowledgeRow } from './KnowledgeRow';

export default function KnowledgeGraphDashboard() {
  const personas = usePersonaStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { failureDrilldownDate, setFailureDrilldownDate } = useOverviewFilters();

  useEffect(() => {
    if (failureDrilldownDate) setSelectedType('failure_pattern');
  }, [failureDrilldownDate]);

  const personaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) map.set(p.id, p.name);
    return map;
  }, [personas]);

  const fetchData = async (isActive: () => boolean = () => true) => {
    if (!isActive()) return;
    setLoading(true);
    setFetchError(null);
    try {
      const [s, e] = await Promise.all([
        getKnowledgeSummary(selectedPersonaId ?? undefined),
        selectedPersonaId
          ? listExecutionKnowledge(selectedPersonaId, selectedType ?? undefined, 100)
          : Promise.resolve([]),
      ]);
      if (!isActive()) return;
      setSummary(s);
      setEntries(e);
    } catch (err) {
      if (!isActive()) return;
      setFetchError(err instanceof Error ? err.message : 'Failed to load knowledge graph data');
      setSummary(null);
      setEntries([]);
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchData(() => active);
    return () => { active = false; };
  }, [selectedPersonaId, selectedType]);

  const rawEntries = selectedPersonaId ? entries : (summary?.top_patterns ?? []);

  const allEntries = useMemo(() => {
    if (!failureDrilldownDate) return rawEntries;
    return rawEntries.filter((entry) => {
      if (entry.failure_count === 0) return false;
      const entryDate = entry.updated_at.slice(0, 10);
      return entryDate >= failureDrilldownDate;
    });
  }, [rawEntries, failureDrilldownDate]);

  const dismissDrilldown = () => {
    setFailureDrilldownDate(null);
    setSelectedType(null);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Network className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Knowledge Graph"
        subtitle={`${summary?.total_entries ?? 0} patterns learned from execution history`}
        actions={
          <Button
            variant="secondary"
            size="xs"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => { void fetchData(); }}
          >
            Refresh
          </Button>
        }
      />

      <ContentBody>
        <div className="space-y-6 pb-6">
          {/* Stat cards */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <OverviewStatCard icon={Network} label="Total Patterns" numericValue={summary.total_entries} format={(n) => String(Math.round(n))} color="primary" />
              <OverviewStatCard icon={ArrowRight} label="Tool Sequences" numericValue={summary.tool_sequence_count} format={(n) => String(Math.round(n))} subtitle="Learned tool chains" color="emerald" />
              <OverviewStatCard icon={AlertTriangle} label="Failure Patterns" numericValue={summary.failure_pattern_count} format={(n) => String(Math.round(n))} subtitle="Known error signatures" color="red" />
              <OverviewStatCard icon={Cpu} label="Model Insights" numericValue={summary.model_performance_count} format={(n) => String(Math.round(n))} subtitle="Performance by model" color="violet" />
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <ThemedSelect value={selectedPersonaId ?? ''} onChange={(e) => setSelectedPersonaId(e.target.value || null)} className="py-1.5">
              <option value="">All Personas (Global)</option>
              {personas.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </ThemedSelect>
            <ThemedSelect
              value={selectedType ?? ''}
              onChange={(e) => {
                setSelectedType(e.target.value || null);
                if (failureDrilldownDate && e.target.value !== 'failure_pattern') setFailureDrilldownDate(null);
              }}
              className="py-1.5"
            >
              <option value="">All Types</option>
              {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => (<option key={key} value={key}>{val.label}</option>))}
            </ThemedSelect>
          </div>

          {/* Failure drilldown banner */}
          {failureDrilldownDate && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">
                    Failure drill-down: {new Date(failureDrilldownDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <p className="text-sm text-red-400/70 mt-0.5">
                    Showing failure patterns active on or after this date.
                    {allEntries.length === 0 && !loading && ' No matching patterns found -- try selecting a specific persona above.'}
                  </p>
                </div>
                <Button variant="danger" size="xs" icon={<X className="w-3 h-3" />} onClick={dismissDrilldown} className="bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25">
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* Entries list */}
          {fetchError && !loading ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">Knowledge data unavailable</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{fetchError}</p>
                </div>
                <Button variant="danger" size="xs" icon={<RefreshCw className="w-3 h-3" />} onClick={() => { void fetchData(); }} className="bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25">
                  Retry
                </Button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin text-primary/40" />
            </div>
          ) : allEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
                <Network className="w-6 h-6 text-violet-400/60" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/80 mb-1">No knowledge patterns yet</h3>
              <p className="text-sm text-muted-foreground/60 max-w-sm">
                Run executions to build the knowledge graph. Every execution teaches the system
                about tool sequences, failure patterns, and cost-quality tradeoffs.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allEntries.map((entry) => (
                <KnowledgeRow key={entry.id} entry={entry} personaName={personaMap.get(entry.persona_id)} />
              ))}
            </div>
          )}

          {/* Recent learnings (global view) */}
          {!selectedPersonaId && summary && summary.recent_learnings.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
                <RefreshCw className="w-3.5 h-3.5 text-primary/60" />
                Recent Learnings
              </h3>
              <div className="space-y-2">
                {summary.recent_learnings.map((entry) => (
                  <KnowledgeRow key={entry.id} entry={entry} personaName={personaMap.get(entry.persona_id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
