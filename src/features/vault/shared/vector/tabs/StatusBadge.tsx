import { StatusBadge as SharedStatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

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
  // The ingest pipeline writes `failed` (kb_ingest.rs), never `error` — the
  // second arm used to fall through to the raw-token branch below.
  if (status === 'error' || status === 'failed') {
    return <SharedStatusBadge variant="error" title={errorMsg || undefined}>{sh.status_error}</SharedStatusBadge>;
  }
  // Everything else is a backend machine token (`indexing`, `pending`). These
  // are language-agnostic identifiers and must never reach the user directly.
  return <SharedStatusBadge variant="warning">{tokenLabel(t, 'kb_document', status)}</SharedStatusBadge>;
}
