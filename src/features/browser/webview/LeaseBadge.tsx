/**
 * Who is driving this tab, and the operator's way to take it back.
 *
 * A lease is visible by design: an agent acting on a page the operator is also
 * looking at, with no marker, is the single most confusing thing this feature
 * could do. Revoke is the escape hatch (rule 5) and only the operator has it —
 * revoking a free tab is the same outcome, not an error, so the control is
 * simply absent when nobody holds it.
 */
import { Hand, Unlock } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserPrincipal } from '../types';

interface LeaseBadgeProps {
  lease: BrowserPrincipal | null;
  onRevoke: () => Promise<void>;
}

export default function LeaseBadge({ lease, onRevoke }: LeaseBadgeProps) {
  const { t, tx } = useTranslation();
  const v = t.browser.webview;

  if (!lease) {
    return (
      <span data-testid="webview-lease">
        <StatusBadge variant="neutral" size="sm">
          {v.lease_free}
        </StatusBadge>
      </span>
    );
  }

  const holder =
    lease === 'operator'
      ? v.lease_you
      : lease === 'athena'
        ? v.lease_athena
        : tx(v.lease_session, { id: lease.replace(/^session:/, '') });

  return (
    <div className="flex items-center gap-1.5" data-testid="webview-lease">
      <StatusBadge accent="amber" size="sm" icon={<Hand className="w-3 h-3" />}>
        {holder}
      </StatusBadge>
      <AsyncButton
        size="xs"
        variant="ghost"
        icon={<Unlock className="w-3.5 h-3.5" />}
        onClick={onRevoke}
        data-testid="webview-lease-revoke"
      >
        {v.revoke}
      </AsyncButton>
    </div>
  );
}
