/**
 * The four chips every Whitelist layout renders for a row — tier, scan state,
 * writes policy, credential. They live here so the ledger, the cards and the
 * master-detail list say the same thing in the same colours; a variant that
 * invented its own vocabulary would make the switcher a comparison of three
 * different products instead of three layouts.
 */
import { KeyRound, ShieldAlert } from 'lucide-react';

import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';

import { isBrowserOriginPattern, type BrowserScanStatus, type BrowserSite } from '../types';

/**
 * A row whose origin carries a wildcard covers more than one site, and that is
 * the single most important thing about it — so every layout says so, in the
 * same word, right beside the origin (which keeps its `*` visible: it is the
 * grammar, not decoration).
 */
export function PatternChip({ origin }: { origin: string }) {
  const { t } = useTranslation();
  if (!isBrowserOriginPattern(origin)) return null;
  return (
    <StatusBadge accent="indigo" size="sm">
      {t.browser.whitelist.pattern_chip}
    </StatusBadge>
  );
}

/** Tier → badge accent. Read-only sites are deliberately muted, not green. */
const TIER_ACCENT = ['slate', 'sky', 'emerald'] as const;

export function TierChip({ tier }: { tier: number | null }) {
  const { t } = useTranslation();
  if (tier === null) {
    return (
      <StatusBadge variant="neutral" size="sm">
        {t.browser.whitelist.tier_unknown}
      </StatusBadge>
    );
  }
  const label = [
    t.browser.whitelist.tier_0,
    t.browser.whitelist.tier_1,
    t.browser.whitelist.tier_2,
  ][tier] ?? t.browser.whitelist.tier_unknown;
  return (
    <StatusBadge accent={TIER_ACCENT[tier] ?? 'slate'} size="sm">
      {label}
    </StatusBadge>
  );
}

const SCAN_VARIANT: Record<BrowserScanStatus, 'neutral' | 'processing' | 'warning' | 'success' | 'error'> = {
  none: 'neutral',
  running: 'processing',
  proposed: 'warning',
  confirmed: 'success',
  failed: 'error',
};

export function ScanChip({ status }: { status: BrowserScanStatus }) {
  const { t } = useTranslation();
  const label = {
    none: t.browser.whitelist.scan_none,
    running: t.browser.whitelist.scan_running,
    proposed: t.browser.whitelist.scan_proposed,
    confirmed: t.browser.whitelist.scan_confirmed,
    failed: t.browser.whitelist.scan_failed,
  }[status];
  return (
    <StatusBadge
      variant={SCAN_VARIANT[status]}
      size="sm"
      icon={status === 'running' ? <LiveStatusDot tone="syncing" /> : undefined}
    >
      {label}
    </StatusBadge>
  );
}

/**
 * How many tools this origin has forced to "ask first". Overrides are
 * tighten-only, so any number here means MORE gating than the page declared —
 * never less.
 */
export function WritesChip({ site }: { site: BrowserSite }) {
  const { t, tx } = useTranslation();
  const count = Object.keys(site.overrides).length;
  if (count === 0) {
    return <span className="typo-caption text-foreground">{t.browser.whitelist.writes_none}</span>;
  }
  return (
    <StatusBadge accent="amber" size="sm" icon={<ShieldAlert className="w-3 h-3" />}>
      {tx(t.browser.whitelist.writes_ask, { count })}
    </StatusBadge>
  );
}

export function CredentialChip({ site }: { site: BrowserSite }) {
  const { t } = useTranslation();
  if (!site.credential_id) {
    return <span className="typo-caption text-foreground">{t.browser.whitelist.credential_none}</span>;
  }
  return (
    <StatusBadge accent="violet" size="sm" icon={<KeyRound className="w-3 h-3" />}>
      {t.browser.whitelist.credential_bound}
    </StatusBadge>
  );
}
