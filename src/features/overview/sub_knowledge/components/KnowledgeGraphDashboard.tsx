import { useEffect, useState, useMemo, useCallback } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, X, Plus, MessageSquare } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getKnowledgeSummary, listExecutionKnowledge, upsertKnowledgeAnnotation } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { OverviewStatCard } from '@/features/overview/sub_observability/components/OverviewStatCard';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { KNOWLEDGE_TYPES, SCOPE_TYPES } from '../libs/knowledgeHelpers';
import { KnowledgeRow } from './KnowledgeRow';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

export default function KnowledgeGraphDashboard() {
  const personas = usePersonaStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const { failureDrilldownDate, setFailureDrilldownDate } = useOverviewFilters();

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
        subtitle={`${summary?.total_entries ?? 0} patterns learned${summary?.annotation_count ? ` · ${summary.annotation_count} annotations` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAnnotateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-sm text-cyan-400 hover:bg-cyan-500/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Annotate
            </button>
            <button onClick={() => { void fetchData(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground/70 hover:text-foreground/90 hover:bg-secondary/60 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
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
                <button onClick={dismissDrilldown} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <X className="w-3 h-3" /> Clear
                </button>
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
                <button onClick={() => { void fetchData(); }} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            </div>
          ) : loading ? (
            <ContentLoader variant="panel" hint="knowledge" />
          ) : allEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
                <Network className="w-6 h-6 text-violet-400/60" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/80 mb-1">No knowledge patterns yet</h3>
              <p className="text-sm text-muted-foreground/60 max-w-sm">
                Run executions to build the knowledge graph. Every execution teaches the system about tool sequences, failure patterns, and cost-quality tradeoffs. Agents can also annotate shared knowledge.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allEntries.map((entry) => (
                <KnowledgeRow key={entry.id} entry={entry} personaName={personaMap.get(entry.persona_id)} onMutated={() => { void fetchData(); }} />
              ))}
            </div>
          )}

          {!selectedPersonaId && summary && summary.recent_learnings.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
                <RefreshCw className="w-3.5 h-3.5 text-primary/60" /> Recent Learnings
              </h3>
              <div className="space-y-2">
                {summary.recent_learnings.map((entry) => (
                  <KnowledgeRow key={entry.id} entry={entry} personaName={personaMap.get(entry.persona_id)} onMutated={() => { void fetchData(); }} />
                ))}
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

/* ─── Add Annotation Modal ────────────────────────────────────────── */

interface AnnotateModalProps {
  personas: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}

function AnnotateModal({ personas, onClose, onCreated }: AnnotateModalProps) {
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim() || !personaId) return;
    setSaving(true);
    try {
      await upsertKnowledgeAnnotation(
        personaId,
        scopeType,
        scopeType !== 'persona' && scopeType !== 'global' ? (scopeId || null) : null,
        text.trim(),
        'user',
      );
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-primary/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground/90 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" /> Add Knowledge Annotation
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Attribution Persona</label>
            <ThemedSelect value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="w-full py-1.5">
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ThemedSelect>
          </div>

          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Scope</label>
            <ThemedSelect value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="w-full py-1.5">
              {Object.entries(SCOPE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
            </ThemedSelect>
          </div>

          {(scopeType === 'tool' || scopeType === 'connector') && (
            <div>
              <label className="text-xs text-muted-foreground/70 mb-1 block">
                {scopeType === 'tool' ? 'Tool Name' : 'Connector / Service Type'}
              </label>
              <input
                type="text"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                placeholder={scopeType === 'tool' ? 'e.g. http_request' : 'e.g. google_workspace'}
                className="w-full px-3 py-1.5 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground/70 mb-1 block">Annotation</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Stripe webhook verification requires the raw request body, not the parsed JSON"
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-xl text-sm text-muted-foreground/70 hover:text-foreground/90 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || !text.trim()}
            className="px-4 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Annotation'}
          </button>
        </div>
      </div>
    </div>
  );
}
