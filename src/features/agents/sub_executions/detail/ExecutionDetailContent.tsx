import { useState, useMemo, useCallback } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { Clock, Calendar, Shield, RotateCw, RefreshCw, Brain, Zap, Copy, Check, Code, MessageSquare, ChevronRight, AlertTriangle, BookOpen, Target, Loader2 } from 'lucide-react';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useAgentStore } from "@/stores/agentStore";
import { isTerminalState } from '@/lib/execution/executionState';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { HighlightedJsonBlock } from './inspector/HighlightedJsonBlock';
import { ErrorExplanationCard } from './ErrorExplanationCard';
import { ExecutionMemories } from './views/ExecutionMemories';
import { ExecutionLogViewer } from './views/ExecutionLogViewer';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

interface ExecutionDetailContentProps {
  execution: PersonaExecution;
  hasInputData: boolean;
  hasOutputData: boolean;
}

// ---------------------------------------------------------------------------
// Output section types
// ---------------------------------------------------------------------------

type OutputSection = 'overview' | 'messages' | 'flow' | 'memories' | 'events' | 'reviews' | 'knowledge' | 'outcome' | 'json';

interface ParsedOutput {
  data: Record<string, unknown>;
  memories: Record<string, unknown>[];
  events: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  userMessage: { title?: string; content?: string; content_type?: string; priority?: string } | null;
  executionFlow: { flows?: Array<Record<string, unknown>> } | null;
  knowledgeAnnotation: Record<string, unknown> | null;
}

function parseOutputData(raw: string | null): ParsedOutput | null {
  if (!raw) return null;

  const result: ParsedOutput = {
    data: {},
    memories: [],
    events: [],
    reviews: [],
    userMessage: null,
    executionFlow: null,
    knowledgeAnnotation: null,
  };

  // Try single JSON object first
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Check if it's a wrapper with nested protocol fields
      if (data.user_message || data.execution_flow || data.memories || data.events) {
        result.data = data;
        result.memories = Array.isArray(data.memories) ? data.memories : [];
        result.events = Array.isArray(data.events) ? data.events : [];
        result.reviews = Array.isArray(data.reviews) ? data.reviews : Array.isArray(data.manual_reviews) ? data.manual_reviews : [];
        result.userMessage = data.user_message ?? null;
        result.executionFlow = data.execution_flow ?? null;
        result.knowledgeAnnotation = data.knowledge_annotation ?? null;
        return result;
      }
    }
  } catch { /* not a single JSON — try NDJSON */ }

  // Parse NDJSON: one protocol message per line
  let foundAny = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.user_message && typeof obj.user_message === 'object') {
        result.userMessage = obj.user_message as ParsedOutput['userMessage'];
        foundAny = true;
      }
      if (obj.execution_flow && typeof obj.execution_flow === 'object') {
        result.executionFlow = obj.execution_flow as ParsedOutput['executionFlow'];
        foundAny = true;
      }
      if (obj.agent_memory && typeof obj.agent_memory === 'object') {
        result.memories.push(obj.agent_memory as Record<string, unknown>);
        foundAny = true;
      }
      if (obj.emit_event && typeof obj.emit_event === 'object') {
        result.events.push(obj.emit_event as Record<string, unknown>);
        foundAny = true;
      }
      if (obj.manual_review && typeof obj.manual_review === 'object') {
        result.reviews.push(obj.manual_review as Record<string, unknown>);
        foundAny = true;
      }
      if (obj.knowledge_annotation && typeof obj.knowledge_annotation === 'object') {
        result.knowledgeAnnotation = obj.knowledge_annotation as Record<string, unknown>;
        foundAny = true;
      }
      if (obj.outcome_assessment && typeof obj.outcome_assessment === 'object') {
        (result.data as Record<string, unknown>).outcome_assessment = obj.outcome_assessment;
        foundAny = true;
      }
    } catch { /* skip unparseable lines */ }
  }

  return foundAny ? result : null;
}

// ---------------------------------------------------------------------------
// Structured output renderers
// ---------------------------------------------------------------------------

function UserMessageCard({ msg }: { msg: NonNullable<ParsedOutput['userMessage']> }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      {msg.title && (
        <div className="px-4 py-3 border-b border-primary/8 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary/60" />
          <span className="text-sm font-semibold text-foreground/90">{msg.title}</span>
          {msg.priority && msg.priority !== 'normal' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
              msg.priority === 'high' || msg.priority === 'urgent'
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>{msg.priority}</span>
          )}
        </div>
      )}
      <div className="px-4 py-3">
        {msg.content && <MarkdownRenderer content={msg.content} className="text-sm" />}
      </div>
    </div>
  );
}

function FlowSteps({ flow }: { flow: NonNullable<ParsedOutput['executionFlow']> }) {
  const steps = flow.flows ?? [];
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const s = step as Record<string, unknown>;
        const status = String(s.status ?? '');
        const statusColor = status === 'completed' ? 'text-emerald-400' : status === 'failed' ? 'text-red-400' : 'text-muted-foreground/50';
        return (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/10">
            <span className="text-xs font-mono text-muted-foreground/40 w-5 text-right">{String(s.step ?? i + 1)}</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-sm text-foreground/80 flex-1">{String(s.action ?? '').replace(/_/g, ' ')}</span>
            <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}

function OutcomeSection({ data }: { data: Record<string, unknown> }) {
  const oa = data.outcome_assessment as Record<string, unknown> | undefined;
  if (!oa) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Target className="w-4 h-4 text-primary/60" />
        <span className="text-sm font-semibold text-foreground/85">Outcome Assessment</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
          oa.accomplished ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>{oa.accomplished ? 'Accomplished' : 'Not Accomplished'}</span>
      </div>
      {typeof oa.summary === 'string' && (
        <p className="text-sm text-foreground/70 leading-relaxed">{oa.summary}</p>
      )}
      {Array.isArray(oa.blockers) && oa.blockers.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Blockers</span>
          {(oa.blockers as string[]).map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-red-400/80">
              <span className="mt-0.5">&#8226;</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button helper
// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-secondary/40 transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExecutionDetailContent({ execution, hasInputData, hasOutputData }: ExecutionDetailContentProps) {
  const executePersona = useAgentStore((s) => s.executePersona);
  const fetchExecutions = useAgentStore((s) => s.fetchExecutions);
  const [showRaw, setShowRaw] = useState(false);
  const [activeSection, setActiveSection] = useState<OutputSection>('overview');
  const [isRerunning, setIsRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<'success' | 'error' | null>(null);

  const handleRerun = useCallback(async () => {
    setIsRerunning(true);
    setRerunResult(null);
    try {
      let inputData: object | undefined;
      if (execution.input_data) {
        try { inputData = JSON.parse(execution.input_data); } catch { /* empty input */ }
      }
      const newId = await executePersona(execution.persona_id, inputData);
      if (newId) {
        setRerunResult('success');
        // Refresh execution list so the new execution appears
        fetchExecutions(execution.persona_id);
      } else {
        setRerunResult('error');
      }
    } catch {
      setRerunResult('error');
    } finally {
      setIsRerunning(false);
    }
  }, [execution.persona_id, execution.input_data, executePersona, fetchExecutions]);

  const parsed = useMemo(() => parseOutputData(execution.output_data), [execution.output_data]);

  // Build available sections from parsed output
  const sections = useMemo(() => {
    const s: Array<{ id: OutputSection; label: string; icon: React.ElementType; count?: number; color: string }> = [];
    if (parsed?.userMessage) s.push({ id: 'messages', label: 'Message', icon: MessageSquare, color: 'text-blue-400' });
    if (parsed?.executionFlow) s.push({ id: 'flow', label: 'Flow', icon: ChevronRight, color: 'text-primary/60' });
    if (parsed && parsed.reviews.length > 0) s.push({ id: 'reviews', label: 'Reviews', icon: AlertTriangle, count: parsed.reviews.length, color: 'text-amber-400' });
    if (parsed && parsed.memories.length > 0) s.push({ id: 'memories', label: 'Memories', icon: Brain, count: parsed.memories.length, color: 'text-violet-400' });
    if (parsed && parsed.events.length > 0) s.push({ id: 'events', label: 'Events', icon: Zap, count: parsed.events.length, color: 'text-amber-400' });
    if (parsed?.knowledgeAnnotation) s.push({ id: 'knowledge', label: 'Insights', icon: BookOpen, color: 'text-emerald-400' });
    if ((parsed?.data as Record<string, unknown>)?.outcome_assessment) s.push({ id: 'outcome', label: 'Outcome', icon: Target, color: 'text-primary/60' });
    if (hasOutputData) s.push({ id: 'json', label: 'Raw JSON', icon: Code, color: 'text-muted-foreground/50' });
    return s;
  }, [parsed, hasOutputData]);

  // Auto-select first meaningful section
  const effectiveSection = sections.find((s) => s.id === activeSection) ? activeSection : (sections[0]?.id ?? 'json');

  return (
    <div className="space-y-5">
      {/* ── Status Bar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${badgeClass(getStatusEntry(execution.status))}`}>
          {getStatusEntry(execution.status).label}
        </span>
        {execution.retry_count > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <RefreshCw className="w-2.5 h-2.5" /> Retry #{execution.retry_count}
          </span>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
          <Clock className="w-3 h-3" /> {formatDuration(execution.duration_ms)}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
          <Calendar className="w-3 h-3" /> {formatTimestamp(execution.started_at)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
              showRaw ? 'bg-amber-500/10 text-amber-400' : 'text-muted-foreground/50 hover:text-muted-foreground/70'
            }`}
          >
            <Shield className="w-3 h-3" /> {showRaw ? 'Raw' : 'Masked'}
          </button>
          {isTerminalState(execution.status) && (
            <button
              onClick={handleRerun}
              disabled={isRerunning}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                rerunResult === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : rerunResult === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-primary/10 text-primary hover:bg-primary/15'
              } disabled:opacity-50`}
            >
              {isRerunning
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Running...</>
                : rerunResult === 'success'
                ? <><Check className="w-3 h-3" /> Started</>
                : rerunResult === 'error'
                ? <><AlertTriangle className="w-3 h-3" /> Failed</>
                : <><RotateCw className="w-3 h-3" /> Re-run</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {execution.error_message && (
        <ErrorExplanationCard errorMessage={execution.error_message} showRaw={showRaw} personaId={execution.persona_id} />
      )}

      {/* ── Content: Split layout (sidebar tabs + content) ──────── */}
      {(hasOutputData || hasInputData) && (
        <div className="flex gap-0 rounded-xl border border-primary/10 overflow-hidden min-h-[300px]">
          {/* Left: Section tabs */}
          {sections.length > 1 && (
            <div className="w-[160px] flex-shrink-0 border-r border-primary/10 bg-secondary/5 py-1">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isActive = effectiveSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSection(sec.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? 'bg-primary/8 border-r-2 border-primary text-foreground/90'
                        : 'text-muted-foreground/60 hover:bg-secondary/30'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? sec.color : ''}`} />
                    <span className="text-xs font-medium truncate">{sec.label}</span>
                    {sec.count != null && (
                      <span className="ml-auto text-[10px] text-muted-foreground/40">{sec.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Right: Content */}
          <div className="flex-1 min-w-0 p-4 overflow-y-auto max-h-[50vh]">
            {effectiveSection === 'messages' && parsed?.userMessage && (
              <UserMessageCard msg={parsed.userMessage} />
            )}

            {effectiveSection === 'flow' && parsed?.executionFlow && (
              <FlowSteps flow={parsed.executionFlow} />
            )}

            {effectiveSection === 'reviews' && parsed && parsed.reviews.length > 0 && (
              <div className="space-y-2.5">
                {parsed.reviews.map((r, i) => (
                  <div key={i} className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3.5 space-y-2">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      {typeof r.title === 'string' && <span className="text-sm font-semibold text-foreground/85">{r.title}</span>}
                      {typeof r.severity === 'string' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                          r.severity === 'high' || r.severity === 'critical'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>{String(r.severity)}</span>
                      )}
                    </div>
                    {typeof r.description === 'string' && <p className="text-sm text-foreground/70 leading-relaxed">{r.description}</p>}
                    {typeof r.context_data === 'string' && (
                      <div className="px-3 py-2 rounded-lg bg-black/10 font-mono text-[11px] text-muted-foreground/60">{r.context_data}</div>
                    )}
                    {Array.isArray(r.suggested_actions) && r.suggested_actions.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Suggested Actions</span>
                        {(r.suggested_actions as string[]).map((a, j) => (
                          <div key={j} className="flex items-start gap-2 text-sm text-foreground/70">
                            <span className="text-primary/40 mt-0.5">&#8226;</span>
                            <span>{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {effectiveSection === 'memories' && parsed && parsed.memories.length > 0 && (
              <div className="space-y-2">
                {parsed.memories.map((m, i) => (
                  <div key={i} className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Brain className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        {typeof m.title === 'string' && <div className="text-sm font-medium text-foreground/85 mb-1">{m.title}</div>}
                        <div className="text-sm text-foreground/70">{String(m.content ?? m.text ?? m.key ?? JSON.stringify(m))}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {typeof m.category === 'string' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400/80">{m.category}</span>}
                          {typeof m.importance === 'number' && <span className="text-[10px] text-muted-foreground/40">importance: {m.importance}/10</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {effectiveSection === 'events' && parsed && parsed.events.length > 0 && (
              <div className="space-y-2">
                {parsed.events.map((e, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-amber-400/80">{String(e.type ?? e.event_type ?? 'event')}</span>
                      {typeof (e.data as Record<string, unknown>)?.status === 'string' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          (e.data as Record<string, unknown>).status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                        }`}>{String((e.data as Record<string, unknown>).status)}</span>
                      )}
                    </div>
                    {typeof e.data === 'object' && e.data && (
                      <div className="mt-2 px-3 py-2 rounded-lg bg-black/10 font-mono text-[11px] text-muted-foreground/50 whitespace-pre-wrap">
                        {JSON.stringify(e.data, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {effectiveSection === 'knowledge' && parsed?.knowledgeAnnotation && (
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground/85">Knowledge Insight</span>
                  {typeof parsed.knowledgeAnnotation.confidence === 'number' && (
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">{Math.round(parsed.knowledgeAnnotation.confidence * 100)}% confidence</span>
                  )}
                </div>
                {typeof parsed.knowledgeAnnotation.scope === 'string' && (
                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/80 font-mono">{parsed.knowledgeAnnotation.scope}</span>
                )}
                {typeof parsed.knowledgeAnnotation.note === 'string' && (
                  <p className="text-sm text-foreground/70 leading-relaxed">{parsed.knowledgeAnnotation.note}</p>
                )}
              </div>
            )}

            {effectiveSection === 'outcome' && parsed && <OutcomeSection data={parsed.data as Record<string, unknown>} />}

            {effectiveSection === 'json' && (
              <div>
                <div className="flex items-center justify-end mb-2">
                  {execution.output_data && <CopyButton text={execution.output_data} label="Copy" />}
                </div>
                <HighlightedJsonBlock raw={showRaw ? execution.output_data : maskSensitiveJson(execution.output_data) as string | null} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Memories Created ────────────────────────────────────────── */}
      <ExecutionMemories executionId={execution.id} executionStatus={execution.status} />

      {/* ── Execution Log ───────────────────────────────────────────── */}
      {execution.log_file_path && (
        <ExecutionLogViewer executionId={execution.id} personaId={execution.persona_id} />
      )}
    </div>
  );
}
