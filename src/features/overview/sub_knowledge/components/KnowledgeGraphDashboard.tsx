import { useEffect, useState, useMemo, useCallback } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, X, Plus, MessageSquare, Brain, BookOpen, Search, ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MotionEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from "@/stores/agentStore";
import { getKnowledgeSummary, listExecutionKnowledge, seedMockKnowledge } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ScrollShadowContainer } from '@/features/shared/components/display/ScrollShadowContainer';
import { PersonaColumnFilter } from '@/features/agents/components/PersonaColumnFilter';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { KNOWLEDGE_TYPES, SCOPE_TYPES } from '../libs/knowledgeHelpers';
import { KnowledgeRow } from './KnowledgeRow';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RevealItem } from '@/features/shared/components/display/RevealItem';

import { AnnotateModal } from './AnnotateModal';
import { matchesQuery } from '@/lib/text/search';
import { silentCatch } from '@/lib/silentCatch';
import { classifyUnknownErrorFull } from '@/lib/errors/errorPipeline';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/** Dev-only knowledge seeding. Declared here rather than gated inside JSX so the
 *  set of things a production build hides is enumerable from the module. */
const SHOW_DEV_SEED = import.meta.env.DEV;
import { createLogger } from "@/lib/log";
import { DebtText, debtText } from '@/i18n/DebtText';


const logger = createLogger("knowledge-graph");

const ENTRY_ROW_ESTIMATE = 64;

export default function KnowledgeGraphDashboard() {
  const { t, language } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  // In-flight state only (docs/design/overview-loading.md law 1-2) — it never
  // hides entries already on screen. It decides only what an EMPTY entry
  // region shows: ghost rows while fetching, the settled empty state once
  // the fetch resolves with nothing.
  const [isFetching, setIsFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showScopeDropdown, setShowScopeDropdown] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'default' | 'confidence' | 'runs' | 'recent'>('default');
  const [pendingOnly, setPendingOnly] = useState(false);
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
    setIsFetching(true);
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
      silentCatch('KnowledgeGraphDashboard:fetch')(err);
      setFetchError(classifyUnknownErrorFull(err).friendly.message);
      setSummary(null);
      setEntries([]);
    } finally {
      if (isActive()) setIsFetching(false);
    }
  }, [selectedPersonaId, selectedType]);

  useEffect(() => {
    let active = true;
    void fetchData(() => active);
    return () => { active = false; };
  }, [fetchData]);

  const rawEntries = useMemo(
    () => (selectedPersonaId ? entries : (summary?.top_patterns ?? [])),
    [selectedPersonaId, entries, summary],
  );

  // Sort before filtering — filtering preserves order, so the displayed subset
  // stays in the chosen order. 'default' keeps the backend ranking untouched.
  const sortedRaw = useMemo(() => {
    if (sortKey === 'default') return rawEntries;
    return [...rawEntries].sort((a, b) => {
      if (sortKey === 'confidence') return b.confidence - a.confidence;
      if (sortKey === 'runs') return (b.success_count + b.failure_count) - (a.success_count + a.failure_count);
      return b.updated_at.localeCompare(a.updated_at); // 'recent'
    });
  }, [rawEntries, sortKey]);

  const { filtered: allEntries } = useFilteredCollection(sortedRaw, {
    exact: [
      { field: 'scope_type', value: selectedScope },
      // Apply the type filter client-side too. The backend list query already
      // narrows by type when a persona is selected, but the no-persona view
      // renders summary.top_patterns (which the query never touches) — without
      // this the type dropdown and the clickable KPI tiles silently no-op there.
      { field: 'knowledge_type', value: selectedType },
    ],
    custom: [
      failureDrilldownDate
        ? (entry) => entry.failure_count > 0 && entry.updated_at.slice(0, 10) >= failureDrilldownDate
        : null,
      search.trim()
        ? (entry) => {
            const q = search.trim().toLowerCase();
            return matchesQuery(entry.pattern_key, q, language)
              || matchesQuery(entry.annotation_text ?? '', q, language);
          }
        : null,
      pendingOnly
        ? (entry) => (entry.knowledge_type === 'agent_annotation' || entry.knowledge_type === 'user_annotation') && !entry.is_verified
        : null,
    ],
  });

  // Progressive reveal — KnowledgeRow is heavy (framer-motion + JSON parse +
  // sparkline), so spread mounting across ~2s after the frame lands rather
  // than dumping up to 100 rows on one frame. Resets when the filter changes.
  const entryReveal = useProgressiveReveal(allEntries.length, {
    resetKey: `${selectedPersonaId ?? ''}|${selectedType ?? ''}|${selectedScope ?? ''}|${failureDrilldownDate ?? ''}|${search.trim()}|${pendingOnly}`,
    initialCount: 16,
  });
  const revealedEntries = useMemo(
    () => allEntries.slice(0, entryReveal.count),
    [allEntries, entryReveal.count],
  );
  // Per-item entrance guard for the (virtualized) entry list. Keyed to the
  // active filters; survives row remount so scrolling never replays the fade.
  const entryEnter = useRevealTracker(`${selectedPersonaId ?? ''}|${selectedType ?? ''}|${selectedScope ?? ''}|${failureDrilldownDate ?? ''}|${search.trim()}|${pendingOnly}`);
  const { parentRef: entryListRef, virtualizer: entryVirtualizer } = useVirtualList(revealedEntries, ENTRY_ROW_ESTIMATE);

  const recentLearnings = !selectedPersonaId && summary ? summary.recent_learnings : [];
  const { parentRef: recentListRef, virtualizer: recentVirtualizer } = useVirtualList(recentLearnings, ENTRY_ROW_ESTIMATE);

  const dismissDrilldown = () => {
    setFailureDrilldownDate(null);
    setSelectedType(null);
  };

  // Single entry point for changing the type filter (KPI tiles + dropdown share
  // it) so the failure-drilldown auto-clear logic lives in exactly one place.
  const chooseType = useCallback((type: string | null) => {
    setSelectedType(type);
    setShowTypeDropdown(false);
    if (failureDrilldownDate && type !== 'failure_pattern') setFailureDrilldownDate(null);
  }, [failureDrilldownDate, setFailureDrilldownDate]);

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
            {entryReveal.isRevealing && (
              <span aria-hidden="true" className="flex items-center gap-1 px-2 py-1 rounded-modal typo-caption text-foreground bg-secondary/20 border border-primary/10">
                <AnimatedCounter value={entryReveal.count} mode="roll" />
                <span>/</span>
                <Numeric>{allEntries.length}</Numeric>
              </span>
            )}
            {SHOW_DEV_SEED && (
              <Tooltip content={t.overview.knowledge_graph.seed_tooltip}>
                <button type="button" onClick={handleSeedKnowledge} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> {t.overview.knowledge_graph.mock_pattern}
                </button>
              </Tooltip>
            )}
            {summary && summary.unverified_annotation_count > 0 && (
              <button
                type="button"
                aria-pressed={pendingOnly}
                onClick={() => { setPendingOnly((v) => !v); if (!pendingOnly) chooseType(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body border transition-colors ${pendingOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-amber-500/20'}`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {t.overview.knowledge.needs_review}
                <span className="px-1.5 rounded-full bg-amber-500/25 typo-caption tabular-nums">
                  <Numeric>{summary.unverified_annotation_count}</Numeric>
                </span>
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
              loading={isFetching}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
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
              {([
                { type: null, icon: Network, label: 'Total Patterns', value: summary.total_entries, color: 'primary', subtitle: undefined },
                { type: 'tool_sequence', icon: ArrowRight, label: 'Tool Sequences', value: summary.tool_sequence_count, color: 'emerald', subtitle: 'Learned tool chains' },
                { type: 'failure_pattern', icon: AlertTriangle, label: 'Failure Patterns', value: summary.failure_pattern_count, color: 'red', subtitle: 'Known error signatures' },
                { type: 'model_performance', icon: Cpu, label: 'Model Insights', value: summary.model_performance_count, color: 'violet', subtitle: 'Performance by model' },
              ] as const).map((tile) => {
                const active = selectedType === tile.type;
                return (
                  <button
                    key={tile.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseType(tile.type)}
                    className={`text-left rounded-modal transition-shadow focus-ring ${active ? 'ring-2 ring-primary/40' : 'hover:ring-1 hover:ring-primary/20'}`}
                  >
                    <KpiTile density="card-rich" icon={tile.icon} label={tile.label} numericValue={tile.value} compact language={language} subtitle={tile.subtitle} color={tile.color} />
                  </button>
                );
              })}
              <KpiTile density="card-rich" icon={MessageSquare} label="Annotations" numericValue={summary.annotation_count} compact language={language} subtitle="Shared knowledge" color="cyan" />
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.overview.knowledge.search_placeholder}
                className="w-full pl-8 pr-8 py-1.5 typo-body rounded-card bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 transition-colors"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label={t.common.clear} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/70">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <PersonaColumnFilter value={selectedPersonaId ?? ''} onChange={(v) => setSelectedPersonaId(v || null)} personas={personas} />

            {/* Two SIBLING controls, not a button inside a button: the clear affordance
                used to be nested, which is invalid HTML and left it unreachable by
                keyboard in several AT/browser pairs, surviving only on stopPropagation. */}
            <span className="relative inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowTypeDropdown(!showTypeDropdown)}
              className={`flex items-center gap-1.5 typo-body transition-colors ${selectedType ? 'text-primary' : 'text-foreground hover:text-foreground'}`}
            >
              {(() => {
                const cfg = KNOWLEDGE_TYPES[selectedType as keyof typeof KNOWLEDGE_TYPES];
                if (!selectedType) return t.overview.knowledge_graph.all_types;
                return cfg ? t.overview.knowledge_graph[cfg.labelKey] : selectedType;
              })()}
            </button>
              {selectedType && (
                <button type="button" aria-label={t.common.clear} onClick={() => { setSelectedType(null); setShowTypeDropdown(false); if (failureDrilldownDate) setFailureDrilldownDate(null); }} className="p-0.5 rounded hover:bg-secondary/50 text-foreground hover:text-muted-foreground/70">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
            {showTypeDropdown && (
              <div className="absolute mt-8 z-50 min-w-[160px] rounded-modal border border-primary/15 bg-background shadow-elevation-3 overflow-hidden">
                <button type="button" onClick={() => chooseType(null)} className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${!selectedType ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary/30'}`}><DebtText k="auto_all_types_eb672cb3" /></button>
                {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => (
                  <button type="button" key={key} onClick={() => chooseType(key)}
                    className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${selectedType === key ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary/30'}`}
                  >{t.overview.knowledge_graph[val.labelKey]}</button>
                ))}
              </div>
            )}

            {/* Two SIBLING controls, not a button inside a button: the clear affordance
                used to be nested, which is invalid HTML and left it unreachable by
                keyboard in several AT/browser pairs, surviving only on stopPropagation. */}
            <span className="relative inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowScopeDropdown(!showScopeDropdown)}
              className={`flex items-center gap-1.5 typo-body transition-colors ${selectedScope ? 'text-primary' : 'text-foreground hover:text-foreground'}`}
            >
              {selectedScope ? (SCOPE_TYPES[selectedScope as keyof typeof SCOPE_TYPES]?.label ?? selectedScope) : 'Scope'}
            </button>
              {selectedScope && (
                <button type="button" aria-label={t.common.clear} onClick={() => { setSelectedScope(null); setShowScopeDropdown(false); }} className="p-0.5 rounded hover:bg-secondary/50 text-foreground hover:text-muted-foreground/70">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
            {showScopeDropdown && (
              <div className="absolute mt-8 z-50 min-w-[140px] rounded-modal border border-primary/15 bg-background shadow-elevation-3 overflow-hidden">
                <button type="button" onClick={() => { setSelectedScope(null); setShowScopeDropdown(false); }} className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${!selectedScope ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary/30'}`}><DebtText k="auto_all_scopes_b64efd49" /></button>
                {Object.entries(SCOPE_TYPES).map(([key, val]) => (
                  <button type="button" key={key} onClick={() => { setSelectedScope(key); setShowScopeDropdown(false); }}
                    className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${selectedScope === key ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary/30'}`}
                  >{val.label}</button>
                ))}
              </div>
            )}

            <ThemedSelect
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              aria-label={t.overview.knowledge.sort_aria}
              wrapperClassName="ml-auto min-w-[150px] flex-shrink-0"
            >
              <option value="default">{t.overview.knowledge.sort_default}</option>
              <option value="confidence">{t.overview.knowledge.sort_confidence}</option>
              <option value="runs">{t.overview.knowledge.sort_runs}</option>
              <option value="recent">{t.overview.knowledge.sort_recent}</option>
            </ThemedSelect>
          </div>

          {pendingOnly && !selectedPersonaId && summary && allEntries.length < summary.unverified_annotation_count && (
            <p className="typo-caption text-amber-400/80 -mt-3">{t.overview.knowledge.pending_scope_hint}</p>
          )}

          {failureDrilldownDate && (
            <div className="rounded-modal border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="typo-body text-red-300">
                    <DebtText k="auto_failure_drill_down_a3e4b117" /> {new Date(failureDrilldownDate + 'T00:00:00').toLocaleDateString(language, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <p className="typo-body text-red-400/70 mt-0.5">
                    <DebtText k="auto_showing_failure_patterns_active_on_or_afte_4e0b968a" />
                    {allEntries.length === 0 && !isFetching && ' No matching patterns found -- try selecting a specific persona above.'}
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

          {fetchError && !isFetching ? (
            <div className="rounded-modal border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="typo-body text-red-300"><DebtText k="auto_knowledge_data_unavailable_273390d7" /></p>
                  <p className="typo-body text-red-400/70 mt-0.5">{fetchError}</p>
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
          ) : isFetching && allEntries.length === 0 ? (
            /* Nothing to show yet + fetch in flight: calm delayed ghost rows.
               Entries already on screen (allEntries.length > 0) are never
               hidden by a refetch — law 1. */
            <KnowledgeGhostRows />
          ) : allEntries.length === 0 && !selectedPersonaId && !selectedType && !selectedScope && !search ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
              <MotionEmptyState
                motif="knowledge"
                content={{
                  icon: Brain,
                  title: debtText("auto_no_knowledge_patterns_yet_fab2639a"),
                  subtitle: "Run agent executions to build up knowledge patterns. Agents get smarter over time.",
                  action: { label: 'Create Persona', onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus },
                  secondaryAction: { label: 'From Templates', onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen },
                  // Wiki-vs-vector guidance (research run 2026-04-08, Karpathy article).
                  // Curated docs belong in the Obsidian vault — cheaper + better for <1000 notes.
                  children: (
                    <div className="max-w-md typo-caption text-foreground text-center px-4 py-2 rounded-card bg-violet-500/5 border border-violet-500/10">
                      <span className="font-medium text-foreground"><DebtText k="auto_curating_documents_manually_2fb8d7db" /></span> <DebtText k="auto_for_fewer_than_1000_notes_an_obsidian_vaul_a955006d" />
                    </div>
                  ),
                }}
              />
            </div>
          ) : allEntries.length === 0 ? (
            <div className="py-8 text-center">
              <p className="typo-body text-foreground"><DebtText k="auto_no_patterns_match_current_filters_99a6d5f1" /></p>
            </div>
          ) : (
            <ScrollShadowContainer
              scrollRef={entryListRef}
              className="overflow-y-auto max-h-[600px] rounded-modal"
              wrapperClassName="relative"
            >
              <div style={{ height: `${entryVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {entryVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = revealedEntries[virtualRow.index]!;
                  return (
                    <RevealItem
                      key={entry.id}
                      revealId={entry.id}
                      order={virtualRow.index - entryReveal.newSince}
                      hasEntered={entryEnter.hasEntered}
                      markEntered={entryEnter.markEntered}
                      data-index={virtualRow.index}
                      ref={entryVirtualizer.measureElement}
                      style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
                      className="pb-2"
                    >
                      <KnowledgeRow entry={entry} personaName={personaMap.get(entry.persona_id)?.name} onMutated={() => { void fetchData(); }} />
                    </RevealItem>
                  );
                })}
              </div>
            </ScrollShadowContainer>
          )}

          {!selectedPersonaId && summary && summary.recent_learnings.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 typo-heading text-foreground">
                <RefreshCw className="w-3.5 h-3.5 text-primary/60" /> <DebtText k="auto_recent_learnings_1994aa0a" />
              </h3>
              <ScrollShadowContainer
                scrollRef={recentListRef}
                className="overflow-y-auto max-h-[400px] rounded-modal"
                wrapperClassName="relative"
              >
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
              </ScrollShadowContainer>
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

// ---------------------------------------------------------------------------
// KnowledgeGhostRows — calm ghost rows for the ONLY moment the entry region
// has nothing to show (a fetch with no matching entries yet). Mirrors
// KnowledgeRow's card-row silhouette. Each enters via `animate-fade-in`
// (150ms, fill-mode: both) behind a staggered animation-delay starting at
// 120ms, so a fast fetch never paints a single ghost. No `animate-pulse`.
// ---------------------------------------------------------------------------

const KNOWLEDGE_GHOST_BAR = 'rounded bg-primary/[0.06]';
const KNOWLEDGE_GHOST_TITLE_WIDTHS = ['w-52', 'w-40', 'w-64', 'w-44'];

function KnowledgeGhostRows() {
  return (
    <div className="rounded-modal overflow-hidden" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const titleW = KNOWLEDGE_GHOST_TITLE_WIDTHS[i % KNOWLEDGE_GHOST_TITLE_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-4 border-b border-primary/[0.06] animate-fade-in"
            style={{ height: ENTRY_ROW_ESTIMATE, animationDelay: delay }}
          >
            <span className="w-8 h-8 rounded-card bg-primary/[0.06] flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <span className={`block h-3.5 ${titleW} max-w-full ${KNOWLEDGE_GHOST_BAR}`} />
              <span className="block h-2.5 w-24 rounded bg-primary/[0.06]" />
            </div>
            <span className="h-5 w-14 rounded-input bg-primary/[0.06] flex-shrink-0" />
          </div>
        );
      })}
    </div>
  );
}
