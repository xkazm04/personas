// VaultActivityCard — credential-vault activity feed for Mission Control.
// Replaced the Obsidian-sync "Vault changes" card (2026-08-26): this one is
// about the CREDENTIAL vault. It merges two ledgers the backend already keeps
// — the immutable credential audit log (create / update / delete / decrypt /
// healthcheck) and the per-credential rotation history (success / failed /
// skipped) — into one newest-first timeline, and counts unhealthy keys
// (last rotation failed, or healthcheck anomaly detected) in the header.
// Two IPC calls, no new backend.

import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, Unlock, Plus, Pencil, Trash2, HeartPulse, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { getCredentialAuditLogGlobal, type CredentialAuditEntry } from '@/api/vault/credentials';
import { getAllRotationStatuses, type RotationStatus } from '@/api/vault/rotation';
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

/**
 * Rotation statuses carry each credential's recent history but NOT its name —
 * names are resolved from the audit log (every credential has at least a
 * `create` row) and fall back to a shortened id.
 */
function rotationsToActivity(
  statuses: Record<string, RotationStatus>,
  nameById: Map<string, string>,
): VaultActivity[] {
  const out: VaultActivity[] = [];
  for (const [credentialId, status] of Object.entries(statuses)) {
    for (const entry of status.recent_history) {
      const kind = `rotation:${entry.status}`;
      out.push({
        id: `rotation:${entry.id}`,
        kind,
        credentialName: nameById.get(credentialId) ?? credentialId.slice(0, 8),
        detail: entry.detail ?? entry.rotation_type,
        createdAt: entry.created_at,
        tone: (KIND_META[kind] ?? FALLBACK_META).tone,
      });
    }
  }
  return out;
}

/** A key is unhealthy when its last rotation failed or its healthchecks flag an anomaly. */
function countUnhealthy(statuses: Record<string, RotationStatus>): number {
  let n = 0;
  for (const s of Object.values(statuses)) {
    if (s.last_status === 'failed' || s.anomaly_detected || s.consecutive_failures > 0) n++;
  }
  return n;
}

export default function VaultActivityCard() {
  const { t, tx } = useTranslation();
  const va = t.overview.vault_activity;
  const [audit, setAudit] = useState<CredentialAuditEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RotationStatus>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // allSettled: a failing rotation-status read must not blank the audit feed
    // (and vice versa) — each source degrades alone.
    Promise.allSettled([getCredentialAuditLogGlobal(AUDIT_FETCH_LIMIT), getAllRotationStatuses()])
      .then(([a, r]) => {
        if (cancelled) return;
        if (a.status === 'fulfilled') setAudit(a.value);
        else silentCatch('dashboard/VaultActivityCard:audit')(a.reason);
        if (r.status === 'fulfilled') setStatuses(r.value);
        else silentCatch('dashboard/VaultActivityCard:rotation')(r.reason);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const e of audit) if (!nameById.has(e.credentialId)) nameById.set(e.credentialId, e.credentialName);
    const merged = [...audit.map(auditToActivity), ...rotationsToActivity(statuses, nameById)];
    merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return merged.slice(0, MAX_ROWS);
  }, [audit, statuses]);

  const unhealthy = useMemo(() => countUnhealthy(statuses), [statuses]);

  // Single fetch on mount (no polling): the tracker's default (no reset key)
  // plays the cascade exactly once. Called above any early return.
  const enter = useRevealTracker();
  const showGhost = !loaded && rows.length === 0;

  const openVault = () => useSystemStore.getState().setSidebarSection('credentials');

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      {/* One row: the shield chip is icon + count only (the words "unhealthy" /
          "all healthy" live in its title/aria-label, so the meaning survives
          for screen readers without a second text run competing for width). */}
      <PaneHeader label={va.title}>
        <div className="flex items-center gap-2">
          {loaded && (
            <span
              className={`inline-flex items-center gap-1 typo-caption font-mono tabular-nums px-1.5 py-0.5 rounded-interactive border ${
                unhealthy > 0
                  ? 'border-status-error/30 bg-status-error/10 text-status-error'
                  : 'border-status-success/30 bg-status-success/10 text-status-success'
              }`}
              title={unhealthy > 0 ? va.unhealthy_hint : va.healthy_hint}
              aria-label={unhealthy > 0 ? tx(va.unhealthy_count, { count: unhealthy }) : va.all_healthy}
            >
              {unhealthy > 0 ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              {unhealthy > 0 && unhealthy}
            </span>
          )}
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
