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

export { formatDuration } from '@/lib/utils/formatters';

export { formatCost } from '@/lib/utils/formatters';

import { formatRelativeTime } from '@/lib/utils/formatters';
export const timeAgo = (iso: string | null) => formatRelativeTime(iso);
