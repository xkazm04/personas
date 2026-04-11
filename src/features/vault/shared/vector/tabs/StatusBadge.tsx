import { StatusBadge as SharedStatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

interface StatusBadgeProps {
  status: string;
  error: string | null;
}

export function StatusBadge({ status, error: errorMsg }: StatusBadgeProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  if (status === 'indexed') {
    return <SharedStatusBadge variant="success">{sh.status_indexed}</SharedStatusBadge>;
  }
  if (status === 'error') {
    return <SharedStatusBadge variant="error" title={errorMsg || undefined}>{sh.status_error}</SharedStatusBadge>;
  }
  return <SharedStatusBadge variant="warning">{status}</SharedStatusBadge>;
}
