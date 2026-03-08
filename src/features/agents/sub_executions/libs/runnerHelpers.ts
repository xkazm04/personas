import { classifyLine } from '@/lib/utils/terminalColors';
import { Zap, Brain, Cpu, CheckCheck, AlertTriangle } from 'lucide-react';

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

/** Duration color for tool-call dots. */
export function dotColor(ms: number | undefined): string {
  if (ms === undefined) return 'bg-blue-400/70';
  if (ms < 2000) return 'bg-emerald-400';
  if (ms < 10000) return 'bg-amber-400';
  return 'bg-red-400';
}

export const PHASE_META: Record<string, { label: string; icon: typeof Zap }> = {
  initializing: { label: 'Initializing', icon: Zap },
  thinking: { label: 'Thinking', icon: Brain },
  calling_tools: { label: 'Running tools', icon: Cpu },
  delegating: { label: 'Delegating to workflow', icon: Zap },
  responding: { label: 'Responding', icon: Brain },
  finalizing: { label: 'Finalizing', icon: CheckCheck },
  error: { label: 'Error', icon: AlertTriangle },
};

export function detectPhaseFromLine(line: string, hasSeenTools: boolean): string | null {
  if (!line.trim()) return null;

  const style = classifyLine(line);
  switch (style) {
    case 'error':  return 'error';
    case 'tool':   return 'calling_tools';
    case 'summary': return 'finalizing';
    case 'meta':   return 'finalizing';
    case 'status':
      return line.startsWith('Session started') ? 'initializing' : 'finalizing';
    case 'text':
      if (line.startsWith('Execution started') || line.startsWith('Cloud execution started')) return 'initializing';
      return hasSeenTools ? 'responding' : 'thinking';
  }

  return null;
}
