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

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
// Note: this file previously used `formatRelativeTime(iso)` with the bare '-'
// fallback — drifted from the other 3 deployment helpers that fell back to
// 'Never'. Fixed to use the canonical 'Never'-fallback variant.
export { formatDuration, formatCost, timeAgo } from '@/lib/utils/formatters';
