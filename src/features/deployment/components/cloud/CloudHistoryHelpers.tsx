import { CheckCircle2, XCircle, Ban } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

export function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'cancelled': return <Ban className="w-3.5 h-3.5 text-amber-400" />;
    default: return <LoadingSpinner size="sm" className="text-blue-400" />;
  }
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCost(usd: number | null): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
