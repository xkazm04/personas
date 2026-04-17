import { useState, useMemo, useCallback } from 'react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaExecution } from '@/lib/types/types';
import { Clock, Calendar, Shield, RotateCw, RefreshCw, Check, Copy, Code, MessageSquare, ChevronRight, AlertTriangle, Brain, Zap, BookOpen, Target, Loader2, type LucideIcon } from 'lucide-react';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useAgentStore } from "@/stores/agentStore";
import { isTerminalState } from '@/lib/execution/executionState';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { HighlightedJsonBlock } from '@/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock';
import { ErrorExplanationCard } from '@/features/agents/sub_executions/detail/ErrorExplanationCard';
import { ExecutionMemories } from '@/features/agents/sub_executions/detail/views/ExecutionMemories';
import { ExecutionLogViewer } from '@/features/agents/sub_executions/detail/views/ExecutionLogViewer';
import { parseOutputData, type OutputSection } from './outputParser';
import { UserMessageCard, FlowSteps, ReviewsList, MemoriesList, EventsList, KnowledgeSection, OutcomeSection } from './OutputSections';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  execution: PersonaExecution;
  hasInputData: boolean;
  hasOutputData: boolean;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors" title={t.shared.execution_detail.copy}>
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

const SECTION_DEFS: Record<string, { icon: LucideIcon; color: string }> = {
  messages: { icon: MessageSquare, color: 'text-blue-400' },
  flow: { icon: ChevronRight, color: 'text-primary/60' },
  reviews: { icon: AlertTriangle, color: 'text-amber-400' },
  memories: { icon: Brain, color: 'text-violet-400' },
  events: { icon: Zap, color: 'text-amber-400' },
  knowledge: { icon: BookOpen, color: 'text-emerald-400' },
  outcome: { icon: Target, color: 'text-primary/60' },
  json: { icon: Code, color: 'text-muted-foreground/50' },
};

export function ExecutionDetailContent({ execution, hasInputData, hasOutputData }: Props) {
  const executePersona = useAgentStore((s) => s.executePersona);
  const fetchExecutions = useAgentStore((s) => s.fetchExecutions);
  const [showRaw, setShowRaw] = useState(false);
  const [activeSection, setActiveSection] = useState<OutputSection>('overview');
  const [isRerunning, setIsRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<'success' | 'error' | null>(null);

  const handleRerun = useCallback(async () => {
    setIsRerunning(true); setRerunResult(null);
    try {
      let inputData: object | undefined;
      if (execution.input_data) { inputData = parseJsonOrDefault(execution.input_data, undefined); }
      const newId = await executePersona(execution.persona_id, inputData);
      setRerunResult(newId ? 'success' : 'error');
      if (newId) fetchExecutions(execution.persona_id);
    } catch { setRerunResult('error'); } finally { setIsRerunning(false); }
  }, [execution.persona_id, execution.input_data, executePersona, fetchExecutions]);

  const parsed = useMemo(() => parseOutputData(execution.output_data), [execution.output_data]);

  const sections = useMemo(() => {
    const s: Array<{ id: OutputSection; label: string; count?: number }> = [];
    if (parsed?.userMessage) s.push({ id: 'messages', label: 'Message' });
    if (parsed?.executionFlow) s.push({ id: 'flow', label: 'Flow' });
    if (parsed && parsed.reviews.length > 0) s.push({ id: 'reviews', label: 'Reviews', count: parsed.reviews.length });
    if (parsed && parsed.memories.length > 0) s.push({ id: 'memories', label: 'Memories', count: parsed.memories.length });
    if (parsed && parsed.events.length > 0) s.push({ id: 'events', label: 'Events', count: parsed.events.length });
    if (parsed?.knowledgeAnnotation) s.push({ id: 'knowledge', label: 'Insights' });
    if ((parsed?.data as Record<string, unknown>)?.outcome_assessment) s.push({ id: 'outcome', label: 'Outcome' });
    if (hasOutputData) s.push({ id: 'json', label: 'Raw JSON' });
    return s;
  }, [parsed, hasOutputData]);

  const effectiveSection = sections.find((s) => s.id === activeSection) ? activeSection : (sections[0]?.id ?? 'json');

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${badgeClass(getStatusEntry(execution.status))}`}>
          {getStatusEntry(execution.status).label}
        </span>
        {execution.retry_count > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <RefreshCw className="w-2.5 h-2.5" /> Retry #{execution.retry_count}
          </span>
        )}
        <span className="flex items-center gap-1 text-sm text-foreground"><Clock className="w-3 h-3" /> {formatDuration(execution.duration_ms)}</span>
        <span className="flex items-center gap-1 text-sm text-foreground"><Calendar className="w-3 h-3" /> {formatTimestamp(execution.started_at)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowRaw(!showRaw)} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${showRaw ? 'bg-amber-500/10 text-amber-400' : 'text-muted-foreground/50 hover:text-muted-foreground/70'}`}>
            <Shield className="w-3 h-3" /> {showRaw ? 'Raw' : 'Masked'}
          </button>
          {isTerminalState(execution.status) && (
            <button onClick={handleRerun} disabled={isRerunning} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
              rerunResult === 'success' ? 'bg-emerald-500/10 text-emerald-400' : rerunResult === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-primary/10 text-primary hover:bg-primary/15'
            } disabled:opacity-50`}>
              {isRerunning ? <><Loader2 className="w-3 h-3 animate-spin" /> Running...</> : rerunResult === 'success' ? <><Check className="w-3 h-3" /> Started</> : rerunResult === 'error' ? <><AlertTriangle className="w-3 h-3" /> Failed</> : <><RotateCw className="w-3 h-3" /> Re-run</>}
            </button>
          )}
        </div>
      </div>

      {execution.error_message && <ErrorExplanationCard errorMessage={execution.error_message} showRaw={showRaw} personaId={execution.persona_id} />}

      {/* Content: sidebar tabs + output */}
      {(hasOutputData || hasInputData) && (
        <div className="flex gap-0 rounded-xl border border-primary/10 overflow-hidden min-h-[300px]">
          {sections.length > 1 && (
            <div className="w-[160px] flex-shrink-0 border-r border-primary/10 bg-secondary/5 py-1">
              {sections.map((sec) => {
                const def = SECTION_DEFS[sec.id];
                const Icon = def?.icon ?? Code;
                const isActive = effectiveSection === sec.id;
                return (
                  <button key={sec.id} onClick={() => setActiveSection(sec.id)} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${isActive ? 'bg-primary/8 border-r-2 border-primary text-foreground/90' : 'text-muted-foreground/60 hover:bg-secondary/30'}`}>
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? def?.color ?? '' : ''}`} />
                    <span className="text-sm font-medium truncate">{sec.label}</span>
                    {sec.count != null && <span className="ml-auto text-sm text-foreground">{sec.count}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex-1 min-w-0 p-4 overflow-y-auto max-h-[50vh]">
            {effectiveSection === 'messages' && parsed?.userMessage && <UserMessageCard msg={parsed.userMessage} />}
            {effectiveSection === 'flow' && parsed?.executionFlow && <FlowSteps flow={parsed.executionFlow} />}
            {effectiveSection === 'reviews' && parsed && parsed.reviews.length > 0 && <ReviewsList reviews={parsed.reviews} />}
            {effectiveSection === 'memories' && parsed && parsed.memories.length > 0 && <MemoriesList memories={parsed.memories} />}
            {effectiveSection === 'events' && parsed && parsed.events.length > 0 && <EventsList events={parsed.events} />}
            {effectiveSection === 'knowledge' && parsed?.knowledgeAnnotation && <KnowledgeSection annotation={parsed.knowledgeAnnotation} />}
            {effectiveSection === 'outcome' && parsed && <OutcomeSection data={parsed.data as Record<string, unknown>} />}
            {effectiveSection === 'json' && (
              <div>
                <div className="flex items-center justify-end mb-2">{execution.output_data && <CopyButton text={execution.output_data} label="Copy" />}</div>
                <HighlightedJsonBlock raw={showRaw ? execution.output_data : maskSensitiveJson(execution.output_data) as string | null} />
              </div>
            )}
          </div>
        </div>
      )}

      <ExecutionMemories executionId={execution.id} executionStatus={execution.status} />
      {execution.log_file_path && <ExecutionLogViewer executionId={execution.id} personaId={execution.persona_id} />}
    </div>
  );
}
