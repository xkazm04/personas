import { memo, useEffect, useMemo, useState, useCallback } from 'react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { Translations } from '@/i18n/en';
import {
  RotateCw, Shield, ShieldOff, AlertTriangle,
  CheckCircle2, Clock, TrendingDown, Timer,
  ExternalLink, Loader2,
} from 'lucide-react';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";
import { silentCatch } from '@/lib/silentCatch';
import type { RotationOverviewItem } from '@/stores/slices/vault/rotationSlice';
import { useRotationOverviewList } from "@/stores/selectors/rotationOverview";

function rotationBadge(item: RotationOverviewItem, t: Translations) {
  const { status } = item;

  if (!status.has_policy) {
    if (status.anomaly_detected) {
      return { label: tokenLabel(t, 'rotation', 'anomaly'), classes: 'bg-status-error/15 border-status-error/25 text-status-error', Icon: AlertTriangle };
    }
    return null;
  }

  if (!status.policy_enabled) {
    return { label: tokenLabel(t, 'rotation', 'paused'), classes: 'bg-surface-1 border-hair text-ink-3', Icon: ShieldOff };
  }

  const rem = status.anomaly_score?.remediation;
  if (rem === 'Disable') {
    return { label: tokenLabel(t, 'rotation', 'disabled'), classes: 'bg-status-error/15 border-status-error/25 text-status-error', Icon: ShieldOff };
  }
  if (rem === 'RotateThenAlert') {
    return { label: tokenLabel(t, 'rotation', 'perm_errors'), classes: 'bg-status-error/10 border-status-error/20 text-status-error', Icon: AlertTriangle };
  }
  if (rem === 'PreemptiveRotation') {
    return { label: tokenLabel(t, 'rotation', 'degrading'), classes: 'bg-status-warning/10 border-status-warning/20 text-status-warning', Icon: TrendingDown };
  }
  if (rem === 'BackoffRetry') {
    return { label: tokenLabel(t, 'rotation', 'backoff'), classes: 'bg-status-warning/10 border-status-warning/20 text-status-warning', Icon: Timer };
  }

  // Fresh / healthy
  if (status.last_status === 'success') {
    return { label: tokenLabel(t, 'rotation', 'fresh'), classes: 'bg-status-success/10 border-status-success/20 text-status-success', Icon: CheckCircle2 };
  }

  return { label: tokenLabel(t, 'rotation', 'active'), classes: 'bg-role-highlight/10 border-role-highlight/20 text-role-highlight', Icon: Shield };
}

/**
 * Structured time-to-rotation. Returns `null` when no rotation is scheduled,
 * `{ isDue: true }` when it is due now, otherwise the remaining days/hours. The
 * component localizes these via `tx()`. Keeping this structured (rather than a
 * pre-formatted string) means the "due now" decision is data-driven and never
 * relies on comparing a localized string — so localization can't break logic.
 */
/**
 * Parse a server timestamp to epoch ms, tolerating both RFC3339 and legacy
 * SQLite-naive ("YYYY-MM-DD HH:MM:SS") shapes. Returns null (not NaN) on an
 * unparseable value — `new Date(naive).getTime()` silently yielded NaN, which
 * flowed into "NaN days" countdowns and undercounted "expiring soon".
 */
function parseServerMs(ts: string): number | null {
  let ms = Date.parse(ts);
  if (Number.isNaN(ms)) ms = Date.parse(ts.replace(' ', 'T'));
  return Number.isNaN(ms) ? null : ms;
}

function countdownParts(
  nextRotation: string | null,
): { isDue: boolean; days: number; hours: number } | null {
  if (!nextRotation) return null;
  const ms = parseServerMs(nextRotation);
  if (ms == null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return { isDue: true, days: 0, hours: 0 };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { isDue: false, days, hours };
}

function summaryStats(items: RotationOverviewItem[]) {
  let active = 0;
  let expiringSoon = 0;
  let anomalies = 0;
  for (const item of items) {
    if (item.status.has_policy && item.status.policy_enabled) active++;
    if (item.status.anomaly_detected) anomalies++;
    if (item.status.next_rotation_at) {
      const ms = parseServerMs(item.status.next_rotation_at);
      if (ms != null) {
        const diff = ms - Date.now();
        if (diff > 0 && diff < 7 * 24 * 60 * 60 * 1000) expiringSoon++;
      }
    }
  }
  return { active, expiringSoon, anomalies, total: items.length };
}

export const RotationOverviewPanel = memo(function RotationOverviewPanel() {
  const rotationOverviewList = useRotationOverviewList();
  const fetchAllRotationStatuses = useVaultStore((s) => s.fetchAllRotationStatuses);
  const rotateCredentialNow = useVaultStore((s) => s.rotateCredentialNow);
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const addToast = useToastStore((s) => s.addToast);

  // Tracks which row is mid-rotation so we can spin its button without
  // blocking sibling rotate clicks.
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  // "No rotation policies configured" is a verdict about the credential list,
  // and neither vault slice carries a loading flag, so this panel had no way to
  // tell "nothing to rotate" from "nothing has arrived yet" — and asserted the
  // first over an empty initial store (docs/design/overview-loading.md,
  // Definition of done: "Empty state renders only when !isFetching"). The read
  // it depends on is the honest signal: `fetchCredentials` is deduped and
  // TTL-cached (createCachedFetch), so awaiting it here costs no extra IPC and
  // is the only place that learns the list has actually come back.
  const [credsSettled, setCredsSettled] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(fetchCredentials())
      .catch(silentCatch('RotationOverviewPanel:fetchCredentials'))
      .finally(() => { if (alive) setCredsSettled(true); });
    return () => { alive = false; };
  }, [fetchCredentials]);

  useEffect(() => {
    if (credentials.length > 0) {
      fetchAllRotationStatuses();
    }
  }, [credentials.length, fetchAllRotationStatuses]);

  const { t, tx } = useTranslation();
  const stats = useMemo(() => summaryStats(rotationOverviewList), [rotationOverviewList]);

  const openConnections = useCallback(() => {
    setSidebarSection('credentials');
  }, [setSidebarSection]);

  const handleRotate = useCallback(async (item: RotationOverviewItem) => {
    if (rotatingId) return;
    setRotatingId(item.credentialId);
    try {
      const result = await rotateCredentialNow(item.credentialId);
      if (result === null) {
        addToast(tx(t.overview.analytics_dashboard.rotation_failed_for, { name: item.credentialName }), 'error');
      } else {
        addToast(tx(t.overview.analytics_dashboard.rotation_started_for, { name: item.credentialName }), 'success');
      }
    } finally {
      setRotatingId(null);
    }
  }, [rotateCredentialNow, addToast, t, tx, rotatingId]);

  // Whether this panel exists at all is itself decided by the credential read,
  // so until that read has come back there is nothing honest to paint: not the
  // rows (none yet), not "no rotation policies configured" (unknown), and not a
  // ghost either — a placeholder for a panel that may legitimately resolve to
  // nothing promises content that will never arrive. overview-loading.md §D
  // sanctions exactly this for an optional widget ("fallback={null} is
  // acceptable for small widgets"); its absence shifts no layout, because
  // absence is already this panel's normal outcome on the line below.
  if (rotationOverviewList.length === 0 && (credentials.length > 0 || !credsSettled)) {
    return null; // No rotation policies configured (or not yet known) -- don't show the panel
  }

  return (
    <div className="rounded-modal border border-hair bg-surface-1 shadow-elevation-1 overflow-hidden flex flex-col">
      {/* Header — compact: icon, title, total badge, summary pills, manage link */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hair bg-surface-1">
        <div className="w-6 h-6 rounded-card bg-role-agent/10 border border-role-agent/20 flex items-center justify-center flex-shrink-0">
          <RotateCw className="w-3 h-3 text-role-agent" />
        </div>
        <h3 className="typo-heading text-ink-2 uppercase truncate">{t.overview.analytics_dashboard.credential_rotation}</h3>
        {stats.total > 0 && (
          <StatusBadge accent="violet" size="sm" className="font-bold flex-shrink-0">
            {stats.total}
          </StatusBadge>
        )}

        {/* Summary pills — pushed right, wrap if needed */}
        <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
          {stats.active > 0 && (
            <StatusBadge variant="success" size="sm" icon={<Shield className="w-2.5 h-2.5" />} title={tx(t.overview.analytics_dashboard.active_count, { count: stats.active })}>
              {stats.active}
            </StatusBadge>
          )}
          {stats.expiringSoon > 0 && (
            <StatusBadge variant="warning" size="sm" icon={<Clock className="w-2.5 h-2.5" />} title={tx(t.overview.analytics_dashboard.soon_count, { count: stats.expiringSoon })}>
              {stats.expiringSoon}
            </StatusBadge>
          )}
          {stats.anomalies > 0 && (
            <StatusBadge variant="error" size="sm" icon={<AlertTriangle className="w-2.5 h-2.5" />} title={stats.anomalies !== 1 ? tx(t.overview.analytics_dashboard.issues_count, { count: stats.anomalies }) : tx(t.overview.analytics_dashboard.issues_count_one, { count: stats.anomalies })}>
              {stats.anomalies}
            </StatusBadge>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={openConnections}
            className="flex-shrink-0"
            iconRight={<ExternalLink className="w-2.5 h-2.5" />}
          >
            {t.overview.analytics_dashboard.rotation_manage_all}
          </Button>
        </div>
      </div>

      {/* Rotation items list */}
      {rotationOverviewList.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <ScenarioEmptyState
            art="vault"
            size="sm"
            title={t.overview.analytics_dashboard.no_rotation_policies}
            subtitle={t.overview.analytics_dashboard.no_rotation_hint}
          />
        </div>
      ) : (
        <div className="divide-y divide-hair">
          {rotationOverviewList.map((item) => {
            const badge = rotationBadge(item, t);
            const cd = countdownParts(item.status.next_rotation_at);
            const isDue = cd?.isDue ?? false;
            const countdown = !cd
              ? ''
              : cd.isDue
                ? t.overview.analytics_dashboard.rotation_due_now
                : cd.days > 0
                  ? tx(t.overview.analytics_dashboard.rotation_countdown_days_hours, { days: cd.days, hours: cd.hours })
                  : tx(t.overview.analytics_dashboard.rotation_countdown_hours, { hours: cd.hours });
            const isRotating = rotatingId === item.credentialId;
            const rotateDisabled = !!rotatingId; // Lock all rotate buttons while one is in flight

            // Status-accent left border (matches the Activity/Messages/IPC
            // tables): credentials with anomalies or consecutive failures read
            // red, rotations due now read amber, healthy rows stay neutral —
            // so the credentials needing attention are scannable down the gutter.
            const rowAccent = (item.status.anomaly_detected || item.status.consecutive_failures > 0)
              ? 'border-l-status-error'
              : isDue
                ? 'border-l-status-warning'
                : 'border-l-transparent';

            return (
              <div
                key={item.credentialId}
                className={`flex items-center gap-2 border-l-2 ${rowAccent} px-3 min-h-[var(--row-h)] hover:bg-surface-2 transition-colors group`}
              >
                {/* Status — icon-only chip, label in title attr */}
                {badge && (
                  <Tooltip content={badge.label}>
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-card border flex-shrink-0 ${badge.classes}`}
                      aria-label={badge.label}
                    >
                      <badge.Icon className="w-3 h-3" />
                    </span>
                  </Tooltip>
                )}

                {/* Credential info — single line: name · service */}
                <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                  <span className="typo-body text-ink-2 truncate">{item.credentialName}</span>
                  <span className="typo-caption text-ink-3 truncate">· {item.serviceType}</span>
                  {item.status.consecutive_failures > 0 && (
                    <StatusBadge
                      variant="error"
                      size="sm"
                      className="flex-shrink-0"
                      title={tx(t.overview.analytics_dashboard.fail_count, { count: item.status.consecutive_failures })}
                    >
                      {item.status.consecutive_failures}x
                    </StatusBadge>
                  )}
                </div>

                {/* Countdown */}
                {countdown && (
                  <span className={`typo-data flex-shrink-0 ${
                    isDue ? 'text-status-warning' : 'text-ink-3'
                  }`}>
                    {countdown}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRotate(item)}
                    disabled={rotateDisabled || !item.status.has_policy}
                    tooltip={t.vault.rotation_section.rotate_now}
                    aria-label={t.vault.rotation_section.rotate_now}
                  >
                    {isRotating
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RotateCw className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={openConnections}
                    tooltip={t.overview.analytics_dashboard.rotation_open_in_connections}
                    aria-label={t.overview.analytics_dashboard.rotation_open_in_connections}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
