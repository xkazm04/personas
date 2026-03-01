import { useEffect, useState, useMemo } from 'react';
import { Network, TrendingUp, AlertTriangle, Cpu, ArrowRight, RefreshCw, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { getKnowledgeSummary, listExecutionKnowledge } from '@/api/knowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';

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

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'from-emerald-500/15 to-emerald-500/5 border-emerald-500/20',
    red: 'from-red-500/15 to-red-500/5 border-red-500/20',
    blue: 'from-blue-500/15 to-blue-500/5 border-blue-500/20',
    violet: 'from-violet-500/15 to-violet-500/5 border-violet-500/20',
    primary: 'from-primary/15 to-primary/5 border-primary/20',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${colorMap[color] ?? colorMap.primary} p-4 space-y-1`}>
      <div className="text-2xl font-bold text-foreground/90 tracking-tight">{value}</div>
      <div className="text-sm font-medium text-foreground/70">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/60">{sub}</div>}
    </div>
  );
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
  try { patternData = JSON.parse(entry.pattern_data); } catch { /* empty */ }

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
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} font-medium`}>
              {config?.label ?? entry.knowledge_type}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground/60">
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
          <span className="text-xs font-mono text-muted-foreground/70 w-8 text-right">
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
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Successes</div>
                <div className="text-sm font-semibold text-emerald-400">{entry.success_count}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Failures</div>
                <div className="text-sm font-semibold text-red-400">{entry.failure_count}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Cost</div>
                <div className="text-sm font-semibold text-foreground/80">{formatCost(entry.avg_cost_usd)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Duration</div>
                <div className="text-sm font-semibold text-foreground/80">{formatDuration(entry.avg_duration_ms)}</div>
              </div>
              {Object.keys(patternData).length > 0 && (
                <div className="col-span-full">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">Pattern Data</div>
                  <pre className="text-xs text-muted-foreground/70 bg-secondary/20 rounded-lg p-2 overflow-x-auto">
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

  const personaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) map.set(p.id, p.name);
    return map;
  }, [personas]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([
        getKnowledgeSummary(selectedPersonaId ?? undefined),
        selectedPersonaId
          ? listExecutionKnowledge(selectedPersonaId, selectedType ?? undefined, 100)
          : Promise.resolve([]),
      ]);
      setSummary(s);
      setEntries(e);
    } catch {
      // Fail silently — empty state will show
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [selectedPersonaId, selectedType]);

  const allEntries = selectedPersonaId ? entries : (summary?.top_patterns ?? []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Network className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Knowledge Graph"
        subtitle={`${summary?.total_entries ?? 0} patterns learned from execution history`}
        actions={
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/40 border border-primary/10 text-sm text-foreground/70 hover:text-foreground/90 hover:bg-secondary/60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <ContentBody>
        <div className="space-y-5 pb-6">
          {/* Stat cards */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Total Patterns" value={summary.total_entries} color="primary" />
              <StatCard
                label="Tool Sequences"
                value={summary.tool_sequence_count}
                sub="Learned tool chains"
                color="emerald"
              />
              <StatCard
                label="Failure Patterns"
                value={summary.failure_pattern_count}
                sub="Known error signatures"
                color="red"
              />
              <StatCard
                label="Model Insights"
                value={summary.model_performance_count}
                sub="Performance by model"
                color="violet"
              />
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedPersonaId ?? ''}
              onChange={(e) => setSelectedPersonaId(e.target.value || null)}
              className="px-3 py-1.5 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All Personas (Global)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <select
              value={selectedType ?? ''}
              onChange={(e) => setSelectedType(e.target.value || null)}
              className="px-3 py-1.5 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All Types</option>
              {Object.entries(KNOWLEDGE_TYPES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>

          {/* Entries list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin text-primary/40" />
            </div>
          ) : allEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
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
