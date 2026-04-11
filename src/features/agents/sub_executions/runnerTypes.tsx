import { Zap, Brain, Cpu, CheckCheck, AlertTriangle } from 'lucide-react';
import { getStatusEntry } from '@/lib/utils/formatters';
import { classifyLine } from '@/lib/utils/terminalColors';

/** Healing event payload from Tauri backend */
export interface HealingEventPayload {
  issue_id: string;
  persona_id: string;
  execution_id: string;
  title: string;
  action: string; // "auto_retry" | "issue_created" | "circuit_breaker"
  auto_fixed: boolean;
  severity: string;
  suggested_fix: string | null;
  persona_name: string;
  description?: string;
  strategy?: string;
  backoff_seconds?: number;
  retry_number?: number;
  max_retries?: number;
}

export interface ToolCallDot {
  toolName: string;
  startMs: number;
  endMs?: number;
}

export interface PhaseEntry {
  id: string;
  label: string;
  startMs: number;
  endMs?: number;
  toolCalls: ToolCallDot[];
}

/** Duration color for tool-call dots -- mirrors ExecutionInspector's durationColor. */
export function dotColor(ms: number | undefined): string {
  if (ms === undefined) return 'bg-blue-400/70'; // still running
  if (ms < 2000) return 'bg-emerald-400';
  if (ms < 10000) return 'bg-amber-400';
  return 'bg-red-400';
}

/**
 * Phase metadata with i18n key references.
 * Labels are resolved at render time via useTranslation().
 * The `labelKey` field stores the i18n key; `label` is set as a fallback for non-React contexts.
 */
export const PHASE_META: Record<string, { label: string; labelKey: string; icon: typeof Zap }> = {
  initializing: { label: 'Initializing', labelKey: 'agents.executions.phase_initializing', icon: Zap },
  thinking: { label: 'Thinking', labelKey: 'agents.executions.phase_thinking', icon: Brain },
  calling_tools: { label: 'Running tools', labelKey: 'agents.executions.phase_calling_tools', icon: Cpu },
  delegating: { label: 'Delegating to workflow', labelKey: 'agents.executions.phase_delegating', icon: Zap },
  responding: { label: 'Responding', labelKey: 'agents.executions.phase_responding', icon: Brain },
  finalizing: { label: 'Finalizing', labelKey: 'agents.executions.phase_finalizing', icon: CheckCheck },
  error: { label: 'Error', labelKey: 'agents.executions.phase_error', icon: AlertTriangle },
};

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const entry = getStatusEntry(status);
  return <entry.icon className={`${entry.text} ${className ?? ''}`} />;
}

export function detectPhaseFromLine(line: string, hasSeenTools: boolean): string | null {
  if (!line.trim()) return null;

  // Use classifyLine as single source of truth for prefix matching
  const style = classifyLine(line);
  switch (style) {
    case 'error':  return 'error';
    case 'tool':   return 'calling_tools';
    case 'summary': return 'finalizing';
    case 'meta':   return 'finalizing';
    case 'status':
      // 'status' covers both initialization and finalization lines
      return line.startsWith('Session started') ? 'initializing' : 'finalizing';
    case 'text':
      // Lines classifyLine doesn't distinguish but are execution-start markers
      if (line.startsWith('Execution started') || line.startsWith('Cloud execution started')) return 'initializing';
      return hasSeenTools ? 'responding' : 'thinking';
  }

  return null;
}
