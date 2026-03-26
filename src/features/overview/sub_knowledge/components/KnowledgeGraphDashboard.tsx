import { useEffect, useState, useMemo, useCallback } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, X, Plus, MessageSquare, Play, Brain, Sparkles } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { getKnowledgeSummary, listExecutionKnowledge, seedMockKnowledge } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { OverviewStatCard } from '@/features/overview/sub_observability/components/OverviewStatCard';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { KNOWLEDGE_TYPES, SCOPE_TYPES } from '../libs/knowledgeHelpers';
import { KnowledgeRow } from './KnowledgeRow';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';

import { AnnotateModal } from './AnnotateModal';
import { createLogger } from "@/lib/log";

const logger = createLogger("knowledge-graph");

export default function KnowledgeGraphDashboard() {
  const personas = useAgentStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const { failureDrilldownDate } = useOverviewFilterValues();
  const { setFailureDrilldownDate } = useOverviewFilterActions();

  useEffect(() => {
    if (failureDrilldownDate) setSelectedType('failure_pattern');
  }, [failureDrilldownDate]);

  const personaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) map.set(p.id, p.name);
    return map;
  }, [personas]);

  const fetchData = useCallback(async (isActive: () => boolean = () => true) => {
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
  }, [selectedPersonaId, selectedType]);

  useEffect(() => {
    let active = true;
    void fetchData(() => active);
    return () => { active = false; };
  }, [fetchData]);

  const rawEntries = selectedPersonaId ? entries : (summary?.top_patterns ?? []);

  const { filtered: allEntries } = useFilteredCollection(rawEntries, {
    exact: [{ field: 'scope_type', value: selectedScope }],
    custom: [
      failureDrilldownDate
        ? (entry) => entry.failure_count > 0 && entry.updated_at.slice(0, 10) >= failureDrilldownDate
        : null,
    ],
  });

  const ENTRY_ROW_ESTIMATE = 64;
  const { parentRef: entryListRef, virtualizer: entryVirtualizer } = useVirtualList(allEntries, ENTRY_ROW_ESTIMATE);

  const recentLearnings = !selectedPersonaId && summary ? summary.recent_learnings : [];
  const { parentRef: recentListRef, virtualizer: recentVirtualizer } = useVirtualList(recentLearnings, ENTRY_ROW_ESTIMATE);

  const dismissDrilldown = () => {
    setFailureDrilldownDate(null);
    setSelectedType(null);
  };

  const handleSeedKnowledge = useCallback(async () => {
    try { await seedMockKnowledge(); await fetchData(); }
    catch (err) { logger.error('Failed to seed mock knowledge', { error: err }); }
  }, [fetchData]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Network className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Knowledge Graph"
        subtitle={`${summary?.total_entries ?? 0} patterns learned${summary?.annotation_count ? ` · ${summary.annotation_count} annotations` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedKnowledge} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock pattern (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Pattern
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAnnotateModal(true)}
              className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20"
            >
              Annotate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => { void fetchData(); }}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <ContentBody>
        <div className="space-y-6 pb-6">
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <OverviewStatCard icon={Network} label="Total Patterns" numericValue={summary.total_entries} format={(n) => String(Math.round(n))} color="primary" />
              <OverviewStatCard icon={ArrowRight} label="Tool Sequences" numericValue={summary.tool_sequence_count} format={(n) => String(Math.round(n))} subtitle="Learned tool chains" color="emerald" />
              <OverviewStatCard icon={AlertTriangle} label="Failure Patterns" numericValue={summary.failure_pattern_count} format={(n) => String(Math.round(n))} subtitle="Known error signatures" color="red" />
              <OverviewStatCard icon={Cpu} label="Model Insights" numericValue={summary.model_performance_count} format={(n) => String(Math.round(n))} subtitle="Performance by model" color="violet" />
              <OverviewStatCard icon={MessageSquare} label="Annotations" numericValue={summary.annotation_count} format={(n) => String(Math.round(n))} subtitle="Shared knowledge" color="cyan" />
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <ThemedSelect value={selectedPersonaId ?? ''} onChange={(e) => setSelectedPersonaId(e.target.value || null)} className="py-1.5">
              <option value="">All Personas (Global)</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ThemedSelect>
            <ThemedSelect value={selectedType ?? ''} onChange={(e) => { setSelectedType(e.target.value || null); if (failureDrilldownDate && e.target.value !== 'failure_pattern') setFailureDrilldownDate(null); }} className="py-1.5">
              <option value="">All Types</option>
              {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
            </ThemedSelect>
            <ThemedSelect value={selectedScope ?? ''} onChange={(e) => setSelectedScope(e.target.value || null)} className="py-1.5">
              <option value="">All Scopes</option>
              {Object.entries(SCOPE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
            </ThemedSelect>
          </div>

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
                <Button
                  variant="danger"
                  size="xs"
                  icon={<X className="w-3 h-3" />}
                  onClick={dismissDrilldown}
                  className="bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25"
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {fetchError && !loading ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">Knowledge data unavailable</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{fetchError}</p>
                </div>
                <Button
                  variant="danger"
                  size="xs"
                  icon={<RefreshCw className="w-3 h-3" />}
                  onClick={() => { void fetchData(); }}
                  className="bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25"
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : loading ? (
            null
          ) : allEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              {/* Neural network constellation illustration */}
              <svg width="160" height="120" viewBox="0 0 160 120" fill="none" className="mb-5 knowledge-constellation">
                <defs>
                  <linearGradient id="kge-link-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
                  </linearGradient>
                  <radialGradient id="kge-node-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* Connection lines */}
                <line x1="40" y1="35" x2="80" y2="55" stroke="url(#kge-link-grad)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="80" y1="55" x2="120" y2="30" stroke="url(#kge-link-grad)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="80" y1="55" x2="55" y2="80" stroke="url(#kge-link-grad)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="80" y1="55" x2="110" y2="85" stroke="url(#kge-link-grad)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="35" x2="25" y2="65" stroke="url(#kge-link-grad)" strokeWidth="1" strokeLinecap="round" />
                <line x1="120" y1="30" x2="140" y2="60" stroke="url(#kge-link-grad)" strokeWidth="1" strokeLinecap="round" />
                <line x1="55" y1="80" x2="110" y2="85" stroke="url(#kge-link-grad)" strokeWidth="1" strokeLinecap="round" />
                <line x1="25" y1="65" x2="55" y2="80" stroke="url(#kge-link-grad)" strokeWidth="1" strokeLinecap="round" />
                <line x1="140" y1="60" x2="110" y2="85" stroke="url(#kge-link-grad)" strokeWidth="1" strokeLinecap="round" />
                {/* Glow halos for pulsing nodes */}
                <circle cx="80" cy="55" r="16" fill="url(#kge-node-glow)" className="knowledge-pulse" />
                <circle cx="40" cy="35" r="10" fill="url(#kge-node-glow)" className="knowledge-pulse-delayed" />
                {/* Primary nodes */}
                <circle cx="80" cy="55" r="5" fill="#8b5cf6" fillOpacity="0.8" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.4" />
                <circle cx="40" cy="35" r="4" fill="#8b5cf6" fillOpacity="0.6" stroke="#a78bfa" strokeWidth="1" strokeOpacity="0.3" />
                <circle cx="120" cy="30" r="4" fill="#06b6d4" fillOpacity="0.6" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.3" />
                {/* Secondary nodes */}
                <circle cx="55" cy="80" r="3" fill="#a78bfa" fillOpacity="0.5" stroke="#a78bfa" strokeWidth="0.75" strokeOpacity="0.3" />
                <circle cx="110" cy="85" r="3" fill="#06b6d4" fillOpacity="0.5" stroke="#06b6d4" strokeWidth="0.75" strokeOpacity="0.3" />
                <circle cx="25" cy="65" r="2.5" fill="#c4b5fd" fillOpacity="0.4" />
                <circle cx="140" cy="60" r="2.5" fill="#67e8f9" fillOpacity="0.4" />
                {/* Tiny satellite nodes */}
                <circle cx="65" cy="25" r="1.5" fill="#a78bfa" fillOpacity="0.3" />
                <circle cx="100" cy="100" r="1.5" fill="#06b6d4" fillOpacity="0.3" />
                <circle cx="135" cy="45" r="1.5" fill="#67e8f9" fillOpacity="0.3" />
              </svg>

              <h3 className="text-sm font-semibold text-foreground/80 mb-3">No knowledge patterns yet</h3>

              <div className="flex items-center gap-6 text-xs text-muted-foreground/70">
                <div className="flex items-center gap-1.5">
                  <Play className="w-3 h-3 text-violet-400" />
                  <span>Run executions</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Brain className="w-3 h-3 text-cyan-400" />
                  <span>Patterns emerge</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  <span>Agents get smarter</span>
                </div>
              </div>

              <style>{`
                @keyframes knowledge-node-pulse {
                  0%, 100% { opacity: 0.3; transform: scale(1); }
                  50% { opacity: 0.7; transform: scale(1.3); }
                }
                .knowledge-pulse {
                  animation: knowledge-node-pulse 3s ease-in-out infinite;
                  transform-origin: center;
                }
                .knowledge-pulse-delayed {
                  animation: knowledge-node-pulse 3s ease-in-out 1.5s infinite;
                  transform-origin: center;
                }
              `}</style>
            </div>
          ) : (
            <div ref={entryListRef} className="overflow-y-auto max-h-[600px] rounded-xl">
              <div style={{ height: `${entryVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {entryVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = allEntries[virtualRow.index]!;
                  return (
                    <div
                      key={entry.id}
                      data-index={virtualRow.index}
                      ref={entryVirtualizer.measureElement}
                      style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
                      className="pb-2"
                    >
                      <KnowledgeRow entry={entry} personaName={personaMap.get(entry.persona_id)} onMutated={() => { void fetchData(); }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!selectedPersonaId && summary && summary.recent_learnings.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
                <RefreshCw className="w-3.5 h-3.5 text-primary/60" /> Recent Learnings
              </h3>
              <div ref={recentListRef} className="overflow-y-auto max-h-[400px] rounded-xl">
                <div style={{ height: `${recentVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {recentVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = recentLearnings[virtualRow.index]!;
                    return (
                      <div
                        key={entry.id}
                        data-index={virtualRow.index}
                        ref={recentVirtualizer.measureElement}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
                        className="pb-2"
                      >
                        <KnowledgeRow entry={entry} personaName={personaMap.get(entry.persona_id)} onMutated={() => { void fetchData(); }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </ContentBody>

      {showAnnotateModal && (
        <AnnotateModal
          personas={personas}
          onClose={() => setShowAnnotateModal(false)}
          onCreated={() => { setShowAnnotateModal(false); void fetchData(); }}
        />
      )}
    </ContentBox>
  );
}
