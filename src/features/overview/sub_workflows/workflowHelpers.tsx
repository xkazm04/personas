import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';

export const JOB_TYPE_LABELS: Record<string, string> = {
  n8n_transform: 'N8n Transform',
  template_adopt: 'Template Adopt',
  template_generate: 'Template Generate',
  query_debug: 'Query Debug',
};

export const STATUS_FILTER_OPTIONS = ['all', 'running', 'completed', 'failed'] as const;
export type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

export function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export function statusBadgeClass(status: string): string {
  if (status === 'running') return 'bg-blue-500/15 text-blue-400 border-blue-500/25';
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  if (status === 'failed') return 'bg-red-500/15 text-red-400 border-red-500/25';
  if (status === 'awaiting_answers') return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return 'bg-secondary/60 text-muted-foreground border-primary/10';
}

export function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'awaiting_answers') return <Clock className="w-3.5 h-3.5 text-amber-400" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}
