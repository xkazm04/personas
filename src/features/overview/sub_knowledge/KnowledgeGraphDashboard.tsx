import { useEffect, useState, useMemo } from 'react';
import { Network, AlertTriangle, Cpu, ArrowRight, RefreshCw, ChevronDown, TrendingUp, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { getKnowledgeSummary, listExecutionKnowledge } from '@/api/overview/intelligence/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { OverviewStatCard } from '@/features/overview/sub_observability/OverviewStatCard';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';

// ── Knowledge type config ─────────────────────────────────────────
const KNOWLEDGE_TYPES: Record<string, { label: string; color: string; icon: typeof Network }> = {
  tool_sequence: { label: 'Tool Sequences', color: 'emerald', icon: ArrowRight },
  failure_pattern: { label: 'Failure Patterns', color: 'red', icon: AlertTriangle },
  cost_quality: { label: 'Cost / Quality', color: 'blue', icon: TrendingUp },
  model_performance: { label: 'Model Performance', color: 'violet', icon: Cpu },
  data_flow: { label: 'Data Flows', color: 'amber', icon: Network },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// ── Knowledge Row ─────────────────────────────────────────────────
function KnowledgeRow({ entry, personaName }: {
  entry: ExecutionKnowledge;
  personaName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = KNOWLEDGE_TYPES[entry.knowledge_type];
  const total = entry.success_count + entry.failure_count;
  const confidencePct = Math.round(entry.confidence * 100);

  const colorMap: Record<string, { text: string; bg: string; border: string }> = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    red: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    blue: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  };
  const colors = colorMap[config?.color ?? 'blue'] ?? colorMap.blue!;
  const Icon = config?.icon ?? Network;

  let patternData: Record<string, unknown> = {};
  try { patternData = JSON.parse(entry.pattern_data); } catch { /* intentional: non-critical — JSON parse fallback */ }

  return (
    <div className="border border-primary/8 rounded-xl bg-background/40 hover:bg-background/60 transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className={`w-7 h-7 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">
              {entry.pattern_key}
            </span>
            <span className={`text-sm px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} font-medium`}>
              {config?.label ?? entry.knowledge_type}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/60">
            {personaName && <span>{personaName}</span>}
            <span>{total} run{total !== 1 ? 's' : ''}</span>
            <span>avg {formatCost(entry.avg_cost_usd)}</span>
            <span>{formatDuration(entry.avg_duration_ms)}</span>
          </div>
        </div>
        {/* Confidence meter */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-16 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                confidencePct >= 70 ? 'bg-emerald-500/70' :
                confidencePct >= 40 ? 'bg-amber-500/70' : 'bg-red-500/70'
              }`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-sm font-mono text-muted-foreground/70 w-8 text-right">
            {confidencePct}%
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Successes</div>
                <div className="text-sm font-semibold text-emerald-400">{entry.success_count}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Failures</div>
                <div className="text-sm font-semibold text-red-400">{entry.failure_count}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Cost</div>
                <div className="text-sm font-semibold text-foreground/80">{formatCost(entry.avg_cost_usd)}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Duration</div>
                <div className="text-sm font-semibold text-foreground/80">{formatDuration(entry.avg_duration_ms)}</div>
              </div>
              {Object.keys(patternData).length > 0 && (
                <div className="col-span-full">
                  <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-1">Pattern Data</div>
                  <pre className="text-sm text-muted-foreground/70 bg-secondary/20 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(patternData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────
export default function KnowledgeGraphDashboard() {
  const personas = usePersonaStore((s) => s.personas);
  const [summary, setSummary] = useState<KnowledgeGraphSummary | null>(null);
  const [entries, setEntries] = useState<ExecutionKnowledge[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { failureDrilldownDate, setFailureDrilldownDate } = useOverviewFilters();

  // When arriving from an observability failure drilldown, auto-set the type filter
  useEffect(() => {
    if (failureDrilldownDate) {
      setSelectedType('failure_pattern');
    }
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
      if (isActive()) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    void fetchData(() => active);
    return () => { active = false; };
  }, [selectedPersonaId, selectedType]);

  const rawEntries = selectedPersonaId ? entries : (summary?.top_patterns ?? []);

  // When drilldown is active, filter to patterns with failures updated on or after the target date
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
          <button
            onClick={() => { void fetchData(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground/70 hover:text-foreground/90 hover:bg-secondary/60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <ContentBody>
        <div className="space-y-6 pb-6">
          {/* Stat cards */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <OverviewStatCard icon={Network} label="Total Patterns" numericValue={summary.total_entries} format={(n) => String(Math.round(n))} color="primary" />
              <OverviewStatCard
                icon={ArrowRight}
                label="Tool Sequences"
                numericValue={summary.tool_sequence_count}
                format={(n) => String(Math.round(n))}
                subtitle="Learned tool chains"
                color="emerald"
              />
              <OverviewStatCard
                icon={AlertTriangle}
                label="Failure Patterns"
                numericValue={summary.failure_pattern_count}
                format={(n) => String(Math.round(n))}
                subtitle="Known error signatures"
                color="red"
              />
              <OverviewStatCard
                icon={Cpu}
                label="Model Insights"
                numericValue={summary.model_performance_count}
                format={(n) => String(Math.round(n))}
                subtitle="Performance by model"
                color="violet"
              />
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <ThemedSelect
              value={selectedPersonaId ?? ''}
              onChange={(e) => setSelectedPersonaId(e.target.value || null)}
              className="py-1.5"
            >
              <option value="">All Personas (Global)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </ThemedSelect>

            <ThemedSelect
              value={selectedType ?? ''}
              onChange={(e) => {
                setSelectedType(e.target.value || null);
                if (failureDrilldownDate && e.target.value !== 'failure_pattern') {
                  setFailureDrilldownDate(null);
                }
              }}
              className="py-1.5"
            >
              <option value="">All Types</option>
              {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
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
                    {allEntries.length === 0 && !loading && ' No matching patterns found — try selecting a specific persona above.'}
                  </p>
                </div>
                <button
                  onClick={dismissDrilldown}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
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
                <button
                  onClick={() => { void fetchData(); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
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
              <h3 className="text-sm font-semibold text-foreground/80 mb-1">
                No knowledge patterns yet
              </h3>
              <p className="text-sm text-muted-foreground/60 max-w-sm">
                Run executions to build the knowledge graph. Every execution teaches the system
                about tool sequences, failure patterns, and cost-quality tradeoffs.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allEntries.map((entry) => (
                <KnowledgeRow
                  key={entry.id}
                  entry={entry}
                  personaName={personaMap.get(entry.persona_id)}
                />
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
                  <KnowledgeRow
                    key={entry.id}
                    entry={entry}
                    personaName={personaMap.get(entry.persona_id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
