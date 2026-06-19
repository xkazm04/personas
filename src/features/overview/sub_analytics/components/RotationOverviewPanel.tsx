import { memo, useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { Translations } from '@/i18n/en';
import {
  RotateCw, Shield, ShieldOff, AlertTriangle,
  CheckCircle2, Clock, TrendingDown, Timer,
  ExternalLink, Loader2,
} from 'lucide-react';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";
import type { RotationOverviewItem } from '@/stores/slices/vault/rotationSlice';
import { useRotationOverviewList } from "@/stores/selectors/rotationOverview";

function rotationBadge(item: RotationOverviewItem, t: Translations) {
  const { status } = item;

  if (!status.has_policy) {
    if (status.anomaly_detected) {
      return { label: tokenLabel(t, 'rotation', 'anomaly'), classes: 'bg-red-500/15 border-red-500/25 text-red-400', Icon: AlertTriangle };
    }
    return null;
  }

  if (!status.policy_enabled) {
    return { label: tokenLabel(t, 'rotation', 'paused'), classes: 'bg-zinc-500/15 border-zinc-500/25 text-zinc-400', Icon: ShieldOff };
  }

  const rem = status.anomaly_score?.remediation;
  if (rem === 'Disable') {
    return { label: tokenLabel(t, 'rotation', 'disabled'), classes: 'bg-red-500/15 border-red-500/25 text-red-400', Icon: ShieldOff };
  }
  if (rem === 'RotateThenAlert') {
    return { label: tokenLabel(t, 'rotation', 'perm_errors'), classes: 'bg-red-500/10 border-red-500/20 text-red-400', Icon: AlertTriangle };
  }
  if (rem === 'PreemptiveRotation') {
    return { label: tokenLabel(t, 'rotation', 'degrading'), classes: 'bg-orange-500/10 border-orange-500/20 text-orange-400', Icon: TrendingDown };
  }
  if (rem === 'BackoffRetry') {
    return { label: tokenLabel(t, 'rotation', 'backoff'), classes: 'bg-amber-500/10 border-amber-500/20 text-amber-400', Icon: Timer };
  }

  // Fresh / healthy
  if (status.last_status === 'success') {
    return { label: tokenLabel(t, 'rotation', 'fresh'), classes: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', Icon: CheckCircle2 };
  }

  return { label: tokenLabel(t, 'rotation', 'active'), classes: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400', Icon: Shield };
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
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const addToast = useToastStore((s) => s.addToast);

  // Tracks which row is mid-rotation so we can spin its button without
  // blocking sibling rotate clicks.
  const [rotatingId, setRotatingId] = useState<string | null>(null);

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

  if (rotationOverviewList.length === 0 && credentials.length > 0) {
    return null; // No rotation policies configured -- don't show the panel
  }

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 shadow-elevation-1 overflow-hidden flex flex-col">
      {/* Header — compact: icon, title, total badge, summary pills, manage link */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
        <div className="w-6 h-6 rounded-card bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
          <RotateCw className="w-3 h-3 text-violet-400" />
        </div>
        <h3 className="typo-heading font-bold text-foreground/90 uppercase tracking-wider truncate">{t.overview.analytics_dashboard.credential_rotation}</h3>
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
          <button
            type="button"
            onClick={openConnections}
            className="inline-flex items-center gap-1 px-2 py-0.5 typo-caption rounded-card text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors flex-shrink-0"
            title={t.overview.analytics_dashboard.rotation_manage_all}
          >
            {t.overview.analytics_dashboard.rotation_manage_all}
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Rotation items list */}
      {rotationOverviewList.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <div className="text-center flex flex-col items-center">
            <div className="w-10 h-10 rounded-modal bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-2 opacity-70">
              <RotateCw className="w-4 h-4 text-violet-400" />
            </div>
            <p className="typo-body font-medium text-foreground">{t.overview.analytics_dashboard.no_rotation_policies}</p>
            <p className="typo-caption text-foreground mt-0.5">{t.overview.analytics_dashboard.no_rotation_hint}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-primary/5">
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
              ? 'border-l-red-400/70'
              : isDue
                ? 'border-l-amber-400/70'
                : 'border-l-transparent';

            return (
              <div
                key={item.credentialId}
                className={`flex items-center gap-2 border-l-2 ${rowAccent} px-3 py-1.5 hover:bg-white/[0.03] transition-colors group`}
              >
                {/* Status — icon-only chip, label in title attr */}
                {badge && (
                  <span
                    className={`inline-flex items-center justify-center w-5 h-5 rounded-card border flex-shrink-0 ${badge.classes}`}
                    title={badge.label}
                    aria-label={badge.label}
                  >
                    <badge.Icon className="w-3 h-3" />
                  </span>
                )}

                {/* Credential info — single line: name · service */}
                <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                  <span className="typo-body font-medium text-foreground/90 truncate">{item.credentialName}</span>
                  <span className="typo-caption text-foreground truncate">· {item.serviceType}</span>
                  {item.status.consecutive_failures > 0 && (
                    <StatusBadge
                      variant="error"
                      size="sm"
                      className="font-mono flex-shrink-0"
                      title={tx(t.overview.analytics_dashboard.fail_count, { count: item.status.consecutive_failures })}
                    >
                      {item.status.consecutive_failures}x
                    </StatusBadge>
                  )}
                </div>

                {/* Countdown */}
                {countdown && (
                  <span className={`typo-caption font-mono flex-shrink-0 ${
                    isDue ? 'text-amber-400 font-semibold' : 'text-foreground'
                  }`}>
                    {countdown}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRotate(item)}
                    disabled={rotateDisabled || !item.status.has_policy}
                    title={t.vault.rotation_section.rotate_now}
                    aria-label={t.vault.rotation_section.rotate_now}
                    className="p-1 rounded-card text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/15 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                  >
                    {isRotating
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RotateCw className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={openConnections}
                    title={t.overview.analytics_dashboard.rotation_open_in_connections}
                    aria-label={t.overview.analytics_dashboard.rotation_open_in_connections}
                    className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
