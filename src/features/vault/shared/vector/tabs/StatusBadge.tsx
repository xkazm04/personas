import { StatusBadge as SharedStatusBadge } from '@/features/shared/components/display/StatusBadge';

interface StatusBadgeProps {
  status: string;
  error: string | null;
}

export function StatusBadge({ status, error: errorMsg }: StatusBadgeProps) {
  if (status === 'indexed') {
    return <SharedStatusBadge variant="success">indexed</SharedStatusBadge>;
  }
  if (status === 'error') {
    return <SharedStatusBadge variant="error" title={errorMsg || undefined}>error</SharedStatusBadge>;
  }
  return <SharedStatusBadge variant="warning">{status}</SharedStatusBadge>;
}
