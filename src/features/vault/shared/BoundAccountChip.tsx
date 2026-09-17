import { UserCheck } from 'lucide-react';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The provider account an OAuth credential is bound to, shown wherever the
 * credential is identified. With several accounts of the same provider in the
 * vault, the service type alone ("google_drive") does not say WHICH account is
 * connected — and a re-auth that silently rebinds to the wrong one is exactly
 * the failure this makes visible.
 *
 * Renders nothing when no account has been recorded yet, so it can be dropped
 * into any credential surface unconditionally.
 */
export function BoundAccountChip({ email, size = 'sm' }: { email: string | null; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  if (!email) return null;
  return (
    <Tooltip content={t.vault.shared.bound_account_tooltip}>
      <span data-testid="bound-account-chip" className="inline-flex">
        <StatusBadge variant="neutral" size={size} icon={<UserCheck className="w-3 h-3" />}>
          <span className="truncate max-w-[180px]">{email}</span>
        </StatusBadge>
      </span>
    </Tooltip>
  );
}
