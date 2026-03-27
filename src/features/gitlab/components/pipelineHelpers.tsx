import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

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
      return <LoadingSpinner className="text-amber-400" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-400" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground/50" />;
  }
}

import { formatDuration as _formatDuration } from '@/lib/utils/formatters';
export const formatDuration = (seconds: number | null) => _formatDuration(seconds, { unit: 's' });

import { formatRelativeTime } from '@/lib/utils/formatters';
export const formatRelative = (iso: string) => formatRelativeTime(iso);
