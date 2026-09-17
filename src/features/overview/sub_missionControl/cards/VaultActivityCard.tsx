// VaultActivityCard — credential-vault activity feed for Mission Control.
// Newest-first slice of the credential audit log (create / update / delete /
// decrypt / healthcheck). Rotation-status N+1 was dropped: this card shows
// eight rows and the audit log is already limited.

import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, ShieldAlert, Unlock, Plus, Pencil, Trash2, HeartPulse, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { getCredentialAuditLogGlobal, type CredentialAuditEntry } from '@/api/vault/credentials';
import { silentCatch } from '@/lib/silentCatch';
import { formatRelativeShort } from '@/features/overview/libs/formatRelativeShort';
import { PaneHeader } from '../PaneHeader';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

const MAX_ROWS = 8;
const ROW_HEIGHT = 32;
const AUDIT_FETCH_LIMIT = 40;

type ActivityTone = 'ok' | 'warn' | 'error' | 'neutral';

interface VaultActivity {
  id: string;
  /** Audit `operation` or `rotation:<status>` — drives icon + tone. */
  kind: string;
  credentialName: string;
  detail: string | null;
  createdAt: string;
  tone: ActivityTone;
}

const KIND_META: Record<string, { Icon: LucideIcon; tone: ActivityTone }> = {
  create:             { Icon: Plus,        tone: 'ok' },
  update:             { Icon: Pencil,      tone: 'neutral' },
  delete:             { Icon: Trash2,      tone: 'warn' },
  decrypt:            { Icon: Unlock,      tone: 'neutral' },
  healthcheck:        { Icon: HeartPulse,  tone: 'neutral' },
  'rotation:success': { Icon: RefreshCw,   tone: 'ok' },
  'rotation:failed':  { Icon: ShieldAlert, tone: 'error' },
  'rotation:skipped': { Icon: RefreshCw,   tone: 'warn' },
};
const FALLBACK_META = { Icon: KeyRound, tone: 'neutral' as ActivityTone };

const TONE_CLASS: Record<ActivityTone, string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-foreground',
};

function auditToActivity(e: CredentialAuditEntry): VaultActivity {
  const meta = KIND_META[e.operation] ?? FALLBACK_META;
  return {
    id: `audit:${e.id}`,
    kind: e.operation,
    credentialName: e.credentialName,
    detail: e.detail ?? e.personaName,
    createdAt: e.createdAt,
    tone: meta.tone,
  };
}

export default function VaultActivityCard() {
  const { t } = useTranslation();
  const va = t.overview.vault_activity;
  const [audit, setAudit] = useState<CredentialAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Audit is already limited (40). The previous companion call dumped
    // every credential's rotation status (N+1) just to client-slice 8 rows.
    getCredentialAuditLogGlobal(AUDIT_FETCH_LIMIT)
      .then((rows) => {
        if (!cancelled) setAudit(rows);
      })
      .catch(silentCatch('dashboard/VaultActivityCard:audit'))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const merged = audit.map(auditToActivity);
    merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return merged.slice(0, MAX_ROWS);
  }, [audit]);

  // Single fetch on mount (no polling): the tracker's default (no reset key)
  // plays the cascade exactly once. Called above any early return.
  const enter = useRevealTracker();
  const showGhost = !loaded && rows.length === 0;

  const openVault = () => useSystemStore.getState().setSidebarSection('credentials');

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader label={va.title}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openVault}
            className="typo-caption text-primary/80 hover:text-primary transition-colors flex items-center gap-1 font-mono uppercase tracking-widest whitespace-nowrap focus-ring rounded-interactive"
          >
            {va.open_vault} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </PaneHeader>
      {showGhost ? (
        <VaultGhostRows />
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 typo-body text-foreground text-center">{va.empty}</div>
      ) : (
        <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
          {rows.map((row, index) => {
            const { Icon } = KIND_META[row.kind] ?? FALLBACK_META;
            const label = row.kind.startsWith('rotation:')
              ? va.kind_rotation
              : (va.kinds as Record<string, string>)[row.kind] ?? row.kind;
            return (
              <RevealItem
                key={row.id}
                revealId={row.id}
                order={index}
                hasEntered={enter.hasEntered}
                markEntered={enter.markEntered}
                className="flex items-center gap-3 px-3 py-1.5"
              >
                <Icon className={`w-3 h-3 flex-shrink-0 ${TONE_CLASS[row.tone]}`} />
                <span className={`typo-caption font-mono uppercase tracking-wider flex-shrink-0 w-14 truncate ${TONE_CLASS[row.tone]}`}>
                  {label}
                </span>
                <span className="typo-body text-foreground truncate flex-1 min-w-0" title={row.detail ?? undefined}>
                  {row.credentialName}
                  {row.detail && <span className="typo-caption text-foreground"> · {row.detail}</span>}
                </span>
                <span className="typo-caption font-mono tabular-nums text-foreground flex-shrink-0">
                  {formatRelativeShort(row.createdAt)?.label ?? '—'}
                </span>
              </RevealItem>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Calm, geometry-matched ghost for the only moment the row region has nothing
// yet (first fetch in flight). Enters behind a ≥120ms staggered delay so a
// fast fetch skips it entirely (docs/design/overview-loading.md law 1).
function VaultGhostRows() {
  const widths = ['w-36', 'w-28', 'w-32', 'w-24'];
  return (
    <div className="divide-y divide-primary/5" aria-hidden="true">
      {widths.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-1.5 animate-fade-in"
          style={{ height: ROW_HEIGHT, animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-3 h-3 rounded bg-primary/[0.06] flex-shrink-0" />
          <span className="h-2.5 w-14 flex-shrink-0 rounded bg-primary/[0.06]" />
          <span className={`h-2.5 ${w} max-w-full flex-1 rounded bg-primary/[0.06]`} />
          <span className="h-2.5 w-10 flex-shrink-0 rounded bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
