import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';

export function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-400';
    case 'failed':
      return 'text-red-400';
    case 'running':
    case 'pending':
      return 'text-amber-400';
    case 'canceled':
    case 'skipped':
      return 'text-muted-foreground/50';
    default:
      return 'text-muted-foreground/70';
  }
}

export function statusBg(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/10 border-emerald-500/20';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20';
    case 'running':
    case 'pending':
      return 'bg-amber-500/10 border-amber-500/20';
    default:
      return 'bg-secondary/30 border-primary/10';
  }
}

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-400" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground/50" />;
  }
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '\u2014';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
