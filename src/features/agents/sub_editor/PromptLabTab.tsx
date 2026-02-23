import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, RotateCcw, FlaskConical, ChevronDown, ChevronRight,
  Shield, Archive, Beaker, Loader2, AlertTriangle, Clock,
  ArrowLeftRight, Play,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  getPromptVersions,
  tagPromptVersion,
  rollbackPromptVersion,
  getPromptErrorRate,
  runPromptAbTest,
} from '@/api/observability';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import type { PromptAbTestResult } from '@/lib/bindings/PromptAbTestResult';
import { parseStructuredPrompt } from '@/lib/personas/promptMigration';

// ── Tag colors ──

const TAG_STYLES: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
  production: { bg: 'bg-emerald-500/15 border-emerald-500/20', text: 'text-emerald-400', icon: Shield },
  experimental: { bg: 'bg-amber-500/15 border-amber-500/20', text: 'text-amber-400', icon: Beaker },
  archived: { bg: 'bg-zinc-500/15 border-zinc-500/20', text: 'text-zinc-400', icon: Archive },
};

// ── Helpers ──

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

/** Extract section summaries from a structured prompt JSON string */
function getSectionSummary(json: string | null): Record<string, string> {
  if (!json) return {};
  const parsed = parseStructuredPrompt(json);
  if (!parsed) return {};
  const result: Record<string, string> = {};
  if (parsed.identity) result['Identity'] = parsed.identity.slice(0, 80);
  if (parsed.instructions) result['Instructions'] = parsed.instructions.slice(0, 80);
  if (parsed.toolGuidance) result['Tool Guidance'] = parsed.toolGuidance.slice(0, 80);
  if (parsed.examples) result['Examples'] = parsed.examples.slice(0, 80);
  if (parsed.errorHandling) result['Error Handling'] = parsed.errorHandling.slice(0, 80);
  return result;
}

/** Simple word-level diff between two strings */
function diffStrings(a: string, b: string): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  const wordsA = a.split(/(\s+)/);
  const wordsB = b.split(/(\s+)/);
  const result: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];

  let i = 0;
  let j = 0;
  while (i < wordsA.length && j < wordsB.length) {
    if (wordsA[i] === wordsB[j]) {
      result.push({ type: 'same', text: wordsA[i]! });
      i++;
      j++;
    } else {
      result.push({ type: 'removed', text: wordsA[i]! });
      result.push({ type: 'added', text: wordsB[j]! });
      i++;
      j++;
    }
  }
  while (i < wordsA.length) {
    result.push({ type: 'removed', text: wordsA[i]! });
    i++;
  }
  while (j < wordsB.length) {
    result.push({ type: 'added', text: wordsB[j]! });
    j++;
  }
  return result;
}

// ── Version List Item ──

function VersionItem({
  version,
  isSelected,
  isCompareA,
  isCompareB,
  onSelect,
  onTag,
  onRollback,
  onSetCompareA,
  onSetCompareB,
  tagging,
}: {
  version: PersonaPromptVersion;
  isSelected: boolean;
  isCompareA: boolean;
  isCompareB: boolean;
  onSelect: () => void;
  onTag: (tag: string) => void;
  onRollback: () => void;
  onSetCompareA: () => void;
  onSetCompareB: () => void;
  tagging: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const style = TAG_STYLES[version.tag] ?? TAG_STYLES.experimental!;
  const TagIcon = style.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group relative rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/30 hover:border-primary/15'
      } ${isCompareA ? 'ring-2 ring-blue-500/40' : ''} ${isCompareB ? 'ring-2 ring-violet-500/40' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left p-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-foreground/90">v{version.version_number}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium border ${style.bg} ${style.text}`}>
            <TagIcon className="w-2.5 h-2.5" />
            {version.tag}
          </span>
          {isCompareA && <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/20 text-blue-400">A</span>}
          {isCompareB && <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/20 text-violet-400">B</span>}
          <span className="ml-auto text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatRelative(version.created_at)}
          </span>
        </div>
        {version.change_summary && (
          <p className="mt-1 text-xs text-muted-foreground/70 truncate">{version.change_summary}</p>
        )}
      </button>

      {/* Action row */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 transition-colors"
        >
          {showActions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Actions
        </button>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareA(); }}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${isCompareA ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground/50 hover:text-blue-400 hover:bg-blue-500/10'}`}
          title="Set as Compare A"
        >
          A
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareB(); }}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${isCompareB ? 'bg-violet-500/20 text-violet-400' : 'text-muted-foreground/50 hover:text-violet-400 hover:bg-violet-500/10'}`}
          title="Set as Compare B"
        >
          B
        </button>
      </div>

      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 px-3 pb-3 border-t border-primary/5 pt-2">
              {version.tag !== 'production' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('production'); }}
                  disabled={tagging}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Shield className="w-3 h-3" /> Promote to Production
                </button>
              )}
              {version.tag !== 'archived' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('archived'); }}
                  disabled={tagging}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
              {version.tag === 'archived' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('experimental'); }}
                  disabled={tagging}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                >
                  <Beaker className="w-3 h-3" /> Unarchive
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onRollback(); }}
                disabled={tagging}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" /> Rollback to this
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Diff Viewer ──

function DiffViewer({ versionA, versionB }: { versionA: PersonaPromptVersion; versionB: PersonaPromptVersion }) {
  const sectionsA = useMemo(() => getSectionSummary(versionA.structured_prompt), [versionA.structured_prompt]);
  const sectionsB = useMemo(() => getSectionSummary(versionB.structured_prompt), [versionB.structured_prompt]);
  const allKeys = useMemo(() => [...new Set([...Object.keys(sectionsA), ...Object.keys(sectionsB)])], [sectionsA, sectionsB]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono">v{versionA.version_number}</span>
        <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 font-mono">v{versionB.version_number}</span>
      </div>

      {allKeys.map((key) => {
        const a = sectionsA[key] ?? '';
        const b = sectionsB[key] ?? '';
        if (a === b) return null;
        const diff = diffStrings(a, b);
        return (
          <div key={key} className="rounded-lg border border-primary/10 bg-secondary/20 p-3">
            <h4 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wider mb-2">{key}</h4>
            <div className="text-sm leading-relaxed">
              {diff.map((d, i) => (
                <span
                  key={i}
                  className={
                    d.type === 'added'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : d.type === 'removed'
                        ? 'bg-red-500/20 text-red-300 line-through'
                        : 'text-foreground/70'
                  }
                >
                  {d.text}
                </span>
              ))}
            </div>
          </div>
        );
      })}

      {allKeys.every((key) => (sectionsA[key] ?? '') === (sectionsB[key] ?? '')) && (
        <p className="text-sm text-muted-foreground/60 text-center py-4">No differences detected in section summaries</p>
      )}
    </div>
  );
}

// ── A/B Test Panel ──

function AbTestPanel({
  personaId,
  compareA,
  compareB,
}: {
  personaId: string;
  compareA: PersonaPromptVersion | null;
  compareB: PersonaPromptVersion | null;
}) {
  const [testInput, setTestInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptAbTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!compareA || !compareB) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runPromptAbTest(
        personaId,
        compareA.id,
        compareB.id,
        testInput.trim() || undefined,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!compareA || !compareB) {
    return (
      <div className="text-sm text-muted-foreground/60 text-center py-6">
        Select two versions (A and B) to run an A/B test
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono">v{compareA.version_number}</span>
        <span className="text-muted-foreground/60">vs</span>
        <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 font-mono">v{compareB.version_number}</span>
      </div>

      <div>
        <label className="text-xs text-muted-foreground/70 block mb-1">Test Input (optional JSON)</label>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder='{"task": "Summarize the latest sales report"}'
          className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
        />
      </div>

      <button
        onClick={() => void handleRun()}
        disabled={running}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 text-sm font-medium"
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {running ? 'Running A/B Test...' : 'Run A/B Test'}
      </button>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground/80">Results</h4>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'A', num: result.version_a_number, r: result.result_a, color: 'blue' },
              { label: 'B', num: result.version_b_number, r: result.result_b, color: 'violet' },
            ].map(({ label, num, r, color }) => (
              <div key={label} className={`rounded-lg border border-${color}-500/20 bg-${color}-500/5 p-3 space-y-2`}>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-mono bg-${color}-500/20 text-${color}-400`}>{label}</span>
                  <span className="text-sm font-mono text-foreground/80">v{num}</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground/80">
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className={r.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>{r.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span>{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost</span>
                    <span>${r.cost_usd.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tokens</span>
                    <span>{r.input_tokens + r.output_tokens}</span>
                  </div>
                </div>
                {r.output_preview && (
                  <div className="mt-2 p-2 rounded bg-background/40 text-xs text-foreground/70 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                    {r.output_preview}
                  </div>
                )}
                {r.error_message && (
                  <p className="text-xs text-red-400 mt-1">{r.error_message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Auto-Rollback Settings ──

function AutoRollbackSettings({ personaId }: { personaId: string }) {
  const [errorRate, setErrorRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchErrorRate = useCallback(async () => {
    setLoading(true);
    try {
      const rate = await getPromptErrorRate(personaId, 10);
      setErrorRate(rate);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void fetchErrorRate();
  }, [fetchErrorRate]);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-400" />
        <h4 className="text-sm font-medium text-foreground/80">Error Rate Monitor</h4>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground/70 mb-1">
            <span>Last 10 executions</span>
            <span>{loading ? '...' : errorRate != null ? `${(errorRate * 100).toFixed(0)}%` : '—'}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-secondary/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                errorRate != null && errorRate > 0.5
                  ? 'bg-red-400'
                  : errorRate != null && errorRate > 0.2
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min((errorRate ?? 0) * 100, 100)}%` }}
            />
          </div>
        </div>
        <button
          onClick={() => void fetchErrorRate()}
          disabled={loading}
          className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
          title="Refresh error rate"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground/50">
        If error rate exceeds 50% after a prompt change, rollback to the production version using the version list above.
      </p>
    </div>
  );
}

// ── Main Prompt Lab Tab ──

export function PromptLabTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const [versions, setVersions] = useState<PersonaPromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [activePanel, setActivePanel] = useState<'diff' | 'ab-test' | 'rollback'>('diff');

  const personaId = selectedPersona?.id;

  const fetchVersions = useCallback(async () => {
    if (!personaId) return;
    setLoading(true);
    try {
      const vs = await getPromptVersions(personaId, 50);
      setVersions(vs);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  const compareA = useMemo(
    () => versions.find((v) => v.id === compareAId) ?? null,
    [versions, compareAId],
  );

  const compareB = useMemo(
    () => versions.find((v) => v.id === compareBId) ?? null,
    [versions, compareBId],
  );

  const handleTag = async (versionId: string, tag: string) => {
    setTagging(true);
    try {
      await tagPromptVersion(versionId, tag);
      await fetchVersions();
    } catch {
      // silent
    } finally {
      setTagging(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    setRolling(true);
    try {
      await rollbackPromptVersion(versionId);
      await fetchVersions();
      await fetchPersonas();
    } catch {
      // silent
    } finally {
      setRolling(false);
    }
  };

  if (!personaId) {
    return <div className="text-sm text-muted-foreground/60 text-center py-8">No persona selected</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Left: Version list */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <GitBranch className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Prompt Versions</h3>
          <span className="ml-auto text-xs text-muted-foreground/60">{versions.length}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-muted-foreground/60 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/60">No versions yet</p>
            <p className="text-xs text-muted-foreground/40">Versions are created automatically when you edit the prompt</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {versions.map((v) => (
              <VersionItem
                key={v.id}
                version={v}
                isSelected={selectedId === v.id}
                isCompareA={compareAId === v.id}
                isCompareB={compareBId === v.id}
                onSelect={() => setSelectedId(selectedId === v.id ? null : v.id)}
                onTag={(tag) => void handleTag(v.id, tag)}
                onRollback={() => void handleRollback(v.id)}
                onSetCompareA={() => setCompareAId(compareAId === v.id ? null : v.id)}
                onSetCompareB={() => setCompareBId(compareBId === v.id ? null : v.id)}
                tagging={tagging || rolling}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Panel tabs */}
        <div className="flex items-center gap-1 mb-3 flex-shrink-0">
          {[
            { id: 'diff' as const, label: 'Compare', icon: ArrowLeftRight },
            { id: 'ab-test' as const, label: 'A/B Test', icon: FlaskConical },
            { id: 'rollback' as const, label: 'Health', icon: Shield },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActivePanel(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activePanel === tab.id
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto">
          {activePanel === 'diff' && (
            compareA && compareB ? (
              <DiffViewer versionA={compareA} versionB={compareB} />
            ) : (
              <div className="text-center py-12 space-y-2">
                <ArrowLeftRight className="w-8 h-8 text-muted-foreground/20 mx-auto" />
                <p className="text-sm text-muted-foreground/60">Select two versions to compare</p>
                <p className="text-xs text-muted-foreground/40">
                  Click the <span className="font-mono bg-blue-500/10 text-blue-400 px-1 rounded">A</span> and <span className="font-mono bg-violet-500/10 text-violet-400 px-1 rounded">B</span> buttons on any version
                </p>
              </div>
            )
          )}

          {activePanel === 'ab-test' && (
            <AbTestPanel personaId={personaId} compareA={compareA} compareB={compareB} />
          )}

          {activePanel === 'rollback' && (
            <AutoRollbackSettings personaId={personaId} />
          )}
        </div>
      </div>
    </div>
  );
}
