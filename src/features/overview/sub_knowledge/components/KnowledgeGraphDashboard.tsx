import { useEffect, useState, useMemo, useCallback } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, X, Plus, MessageSquare, Brain, BookOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from "@/stores/agentStore";
import { getKnowledgeSummary, listExecutionKnowledge, seedMockKnowledge } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
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
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showScopeDropdown, setShowScopeDropdown] = useState(false);
  const { failureDrilldownDate } = useOverviewFilterValues();
  const { setFailureDrilldownDate } = useOverviewFilterActions();

  useEffect(() => {
    if (failureDrilldownDate) setSelectedType('failure_pattern');
  }, [failureDrilldownDate]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; icon: string | null; color: string | null }>();
    for (const p of personas) map.set(p.id, { name: p.name, icon: p.icon, color: p.color });
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
        title={t.overview.knowledge.title}
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

          <div className="flex items-center gap-4 flex-wrap">
            <PersonaColumnFilter value={selectedPersonaId ?? ''} onChange={(v) => setSelectedPersonaId(v || null)} personas={personas} />

            <button
              type="button"
              onClick={() => setShowTypeDropdown(!showTypeDropdown)}
              className={`relative flex items-center gap-1.5 text-sm font-medium transition-colors ${selectedType ? 'text-primary' : 'text-foreground/80 hover:text-foreground'}`}
            >
              {selectedType ? (KNOWLEDGE_TYPES[selectedType as keyof typeof KNOWLEDGE_TYPES]?.label ?? selectedType) : 'Type'}
              {selectedType && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedType(null); setShowTypeDropdown(false); if (failureDrilldownDate) setFailureDrilldownDate(null); }} className="ml-0.5 p-0.5 rounded hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground/70">
                  <X className="w-3 h-3" />
                </button>
              )}
            </button>
            {showTypeDropdown && (
              <div className="absolute mt-8 z-50 min-w-[160px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 overflow-hidden">
                <button onClick={() => { setSelectedType(null); setShowTypeDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${!selectedType ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/70 hover:bg-secondary/30'}`}>All Types</button>
                {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => (
                  <button key={key} onClick={() => { setSelectedType(key); setShowTypeDropdown(false); if (failureDrilldownDate && key !== 'failure_pattern') setFailureDrilldownDate(null); }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${selectedType === key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/70 hover:bg-secondary/30'}`}
                  >{val.label}</button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowScopeDropdown(!showScopeDropdown)}
              className={`relative flex items-center gap-1.5 text-sm font-medium transition-colors ${selectedScope ? 'text-primary' : 'text-foreground/80 hover:text-foreground'}`}
            >
              {selectedScope ? (SCOPE_TYPES[selectedScope as keyof typeof SCOPE_TYPES]?.label ?? selectedScope) : 'Scope'}
              {selectedScope && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedScope(null); setShowScopeDropdown(false); }} className="ml-0.5 p-0.5 rounded hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground/70">
                  <X className="w-3 h-3" />
                </button>
              )}
            </button>
            {showScopeDropdown && (
              <div className="absolute mt-8 z-50 min-w-[140px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 overflow-hidden">
                <button onClick={() => { setSelectedScope(null); setShowScopeDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${!selectedScope ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/70 hover:bg-secondary/30'}`}>All Scopes</button>
                {Object.entries(SCOPE_TYPES).map(([key, val]) => (
                  <button key={key} onClick={() => { setSelectedScope(key); setShowScopeDropdown(false); }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${selectedScope === key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/70 hover:bg-secondary/30'}`}
                  >{val.label}</button>
                ))}
              </div>
            )}
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
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-5 h-5 text-muted-foreground/40 animate-spin" />
                <p className="text-sm text-muted-foreground/60">Loading knowledge patterns...</p>
              </div>
            </div>
          ) : allEntries.length === 0 && !selectedPersonaId && !selectedType && !selectedScope ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
              <EmptyState
                icon={Brain}
                title="No knowledge patterns yet"
                subtitle="Run agent executions to build up knowledge patterns. Agents get smarter over time."
                iconColor="text-violet-400/80"
                iconContainerClassName="bg-violet-500/10 border-violet-500/20"
                action={{ label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
                secondaryAction={{ label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
              />
              {/* Wiki-vs-vector guidance (research run 2026-04-08, Karpathy article). */}
              {/* This dashboard surfaces auto-extracted execution knowledge. For curated docs,
                  personas also offers an Obsidian vault — cheaper and better for <1000 notes. */}
              <div className="max-w-md text-xs text-muted-foreground/60 text-center px-4 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
                <span className="font-medium text-muted-foreground/80">Curating documents manually?</span> For fewer than ~1000 notes, an Obsidian vault is usually cheaper and better than a vector store — cross-links beat chunk similarity and the content stays human-editable.
              </div>
            </div>
          ) : allEntries.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground/40">No patterns match current filters</p>
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
                      <KnowledgeRow entry={entry} personaName={personaMap.get(entry.persona_id)?.name} onMutated={() => { void fetchData(); }} />
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
                        <KnowledgeRow entry={entry} personaName={personaMap.get(entry.persona_id)?.name} onMutated={() => { void fetchData(); }} />
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
