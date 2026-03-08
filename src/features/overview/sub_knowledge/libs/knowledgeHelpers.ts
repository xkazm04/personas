import { Network, AlertTriangle, TrendingUp, Cpu, ArrowRight } from 'lucide-react';

export const KNOWLEDGE_TYPES: Record<string, { label: string; color: string; icon: typeof Network }> = {
  tool_sequence: { label: 'Tool Sequences', color: 'emerald', icon: ArrowRight },
  failure_pattern: { label: 'Failure Patterns', color: 'red', icon: AlertTriangle },
  cost_quality: { label: 'Cost / Quality', color: 'blue', icon: TrendingUp },
  model_performance: { label: 'Model Performance', color: 'violet', icon: Cpu },
  data_flow: { label: 'Data Flows', color: 'amber', icon: Network },
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const COLOR_MAP: Record<string, { text: string; bg: string; border: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  red: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  blue: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
};
