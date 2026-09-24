/**
 * Settings -> API Keys -> Connected apps.
 *
 * One row per paired origin, not one per key: every re-pair mints a fresh key
 * and never retires the old one (approve_pairing), so a per-key list grows a
 * row per pairing. The row states whether the app can still authenticate
 * (its newest live pairing) and how many dead pairings sit behind it; a single
 * reviewed pass (RetireKeysDialog) retires them.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, Check, Globe, History, Unplug } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime, formatTimestamp } from '@/lib/utils/formatters';
import { useConfirmClick } from '@/features/settings/shared/useConfirmClick';
import { revokePairing } from '@/api/auth/pairing';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { expiryInfo, groupPairings, type PairingGroup } from '../libs/keyLifecycle';
import { RetireKeysDialog } from './RetireKeysDialog';

interface ConnectedAppsSectionProps {
  keys: readonly ExternalApiKey[];
  actioningId: string | null;
  onDisconnect: (id: string) => void;
  onAudit: (key: ExternalApiKey) => void;
  /** Reload the key list after a retire pass. */
  onRetired: () => void;
}

export function ConnectedAppsSection({ keys, actioningId, onDisconnect, onAudit, onRetired }: ConnectedAppsSectionProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.api_keys;
  const groups = useMemo(() => groupPairings(keys), [keys]);
  const retireCount = groups.reduce((n, g) => n + g.retirable.length, 0);
  const [reviewing, setReviewing] = useState(false);

  if (groups.length === 0) return null;

  return (
    <div className="mt-6">
      <SectionCard
        title={s.connected_apps_title}
        icon={<Globe className="w-4 h-4 text-sky-400" />}
        titleClassName="text-primary"
      >
        <div className="flex items-center gap-3 mb-2">
          <p className="typo-caption text-foreground flex-1">{s.connected_apps_desc}</p>
          {retireCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Unplug size={12} />}
              onClick={() => setReviewing(true)}
              data-testid="retire-open"
            >
              {tx(s.retire_open, { count: retireCount })}
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {groups.map((g) => (
            <PairingGroupRow
              key={g.origin}
              group={g}
              actioning={g.current !== null && actioningId === g.current.id}
              onDisconnect={onDisconnect}
              onAudit={onAudit}
            />
          ))}
        </div>
      </SectionCard>
      {reviewing && (
        <RetireKeysDialog
          keys={keys}
          revoke={revokePairing}
          onClose={() => setReviewing(false)}
          onDone={onRetired}
        />
      )}
    </div>
  );
}

interface PairingGroupRowProps {
  group: PairingGroup;
  actioning: boolean;
  onDisconnect: (id: string) => void;
  onAudit: (key: ExternalApiKey) => void;
}

function PairingGroupRow({ group, actioning, onDisconnect, onAudit }: PairingGroupRowProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.api_keys;
  const { current } = group;
  const shown = current ?? group.keys[0]!;
  const { armed: confirm, trigger: triggerDisconnect } = useConfirmClick(() => {
    if (current) onDisconnect(current.id);
  });
  const expiry = current ? expiryInfo(current) : null;
  const expiredCount = group.retirable.filter((c) => c.reason === 'expired').length;
  const olderCount = group.retirable.length - expiredCount;
  const lastUsed = formatRelativeTime(shown.last_used_at, s.never_used, { dateFallbackDays: 30 });

  return (
    <div
      data-testid="connected-app-row"
      className={`flex items-center gap-3 px-3 py-2.5 rounded-card border ${
        current ? 'border-border/30 bg-secondary/20' : 'border-border/20 bg-secondary/10'
      }`}
    >
      <Globe className="w-4 h-4 text-sky-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-foreground truncate">{shown.name}</span>
          {current && expiry ? (
            <Tooltip content={formatTimestamp(current.expires_at)}>
              <span className="typo-caption px-1.5 py-0.5 rounded inline-flex items-center gap-1 text-foreground bg-secondary/40">
                <CalendarClock size={10} />
                {tx(s.expires_in, { days: expiry.days })}
              </span>
            </Tooltip>
          ) : !current ? (
            <span className="typo-caption px-1.5 py-0.5 rounded inline-flex items-center gap-1 text-red-400 bg-red-400/10 border border-red-400/30">
              <CalendarClock size={10} />
              {s.connected_apps_no_live}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 mt-1 min-w-0">
          <code className="typo-code text-foreground truncate max-w-[16rem]">{group.origin}</code>
          <span className="typo-caption text-foreground">·</span>
          <span className="typo-caption text-foreground">
            {s.last_used}: {lastUsed}
          </span>
          {olderCount > 0 && (
            <span className="typo-caption text-amber-400">{tx(s.connected_apps_older_count, { count: olderCount })}</span>
          )}
          {expiredCount > 0 && (
            <span className="typo-caption text-red-400">{tx(s.connected_apps_expired_count, { count: expiredCount })}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip content={s.audit_tooltip}>
          <button
            type="button"
            onClick={() => onAudit(shown)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <History size={12} />
            {s.audit}
          </button>
        </Tooltip>
        {current && (
          <Tooltip content={s.connected_apps_revoke_tooltip}>
            <button
              type="button"
              onClick={triggerDisconnect}
              disabled={actioning}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption transition-colors disabled:is-disabled ${
                confirm ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20' : 'text-foreground hover:text-red-400 hover:bg-red-400/10'
              }`}
            >
              {confirm ? <Check size={12} /> : <Unplug size={12} />}
              {confirm ? s.confirm_delete : s.connected_apps_revoke}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
