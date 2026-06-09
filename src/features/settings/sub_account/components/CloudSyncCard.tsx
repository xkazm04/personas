import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudUpload, RefreshCw, ChevronDown, AlertCircle, MonitorSmartphone } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SpringCount } from '@/features/shared/components/display/SpringCount';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { getCloudSyncStatus, setCloudSyncEnabled, cloudSyncNow } from '@/api/cloudSync';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';
import type { TableSyncStatus } from '@/lib/bindings/TableSyncStatus';

type ConnState = 'off' | 'active' | 'syncing';

function connState(status: CloudSyncStatus | null): ConnState {
  if (!status?.enabled) return 'off';
  return status.syncing ? 'syncing' : 'active';
}

/**
 * Cloud dashboard sync panel (v2). Rendered only when signed in with Google.
 * Surfaces live connection state, a per-table sync breakdown, lifetime totals,
 * the device id, and inline error recovery — all driven by the rich
 * `CloudSyncStatus` the backend returns.
 */
export default function CloudSyncCard() {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getCloudSyncStatus());
    } catch (e) {
      toastCatch('CloudSyncCard:status')(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  // While a pass is in flight, poll until it settles so the UI animates live
  // without the user clicking refresh.
  useEffect(() => {
    if (!status?.syncing) return;
    pollTimer.current = setTimeout(() => {
      void refresh();
    }, 1500);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [status?.syncing, status?.lastSyncAt, refresh]);

  const enabled = status?.enabled ?? false;
  const state = connState(status);
  // First paint: status is null until getCloudSyncStatus() resolves. Render
  // shimmer placeholders instead of the resolved "off" state so the panel never
  // flashes off → active when the real status arrives.
  const loading = status === null;

  const onToggle = async () => {
    const next = !enabled;
    setBusy(true);
    setStatus((prev) => (prev ? { ...prev, enabled: next } : prev));
    try {
      await setCloudSyncEnabled(next);
      await refresh();
    } catch (e) {
      setStatus((prev) => (prev ? { ...prev, enabled: !next } : prev));
      toastCatch('CloudSyncCard:setEnabled', s.cloud_sync_enable_failed)(e);
    } finally {
      setBusy(false);
    }
  };

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      const fresh = await cloudSyncNow();
      setStatus(fresh);
      useToastStore
        .getState()
        .addToast(interpolate(s.cloud_sync_now_done, { count: Number(fresh.rowsSyncedLast) }), 'success');
    } catch (e) {
      toastCatch('CloudSyncCard:syncNow', s.cloud_sync_now_failed)(e);
    } finally {
      setSyncing(false);
    }
  };

  const stateLabel =
    state === 'syncing'
      ? s.cloud_sync_state_syncing
      : state === 'active'
        ? s.cloud_sync_state_active
        : s.cloud_sync_state_off;

  const tableLabels = s.cloud_sync_tables as Record<string, string>;
  const tables: TableSyncStatus[] = status?.tables ?? [];
  const hasError = !!status?.lastError;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading title={s.cloud_sync_title} icon={<CloudUpload className="text-sky-400" />} />
        {loading ? (
          <span className="h-[26px] w-24 rounded-full bg-secondary/30 animate-pulse" aria-hidden />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/30 border border-primary/10 px-2.5 py-1 typo-caption font-medium text-foreground">
            <LiveStatusDot tone={state} />
            {stateLabel}
          </span>
        )}
      </div>

      <p className="typo-body text-foreground leading-relaxed">{s.cloud_sync_description}</p>

      {/* Toggle */}
      {loading ? (
        <div
          className="flex items-center justify-between gap-4 rounded-card bg-secondary/20 border border-primary/8 p-4"
          aria-hidden
        >
          <div className="min-w-0 space-y-2">
            <span className="block h-3.5 w-32 rounded-card bg-secondary/30 animate-pulse" />
            <span className="block h-3 w-20 rounded-card bg-secondary/30 animate-pulse" />
          </div>
          <span className="h-6 w-10 flex-shrink-0 rounded-full bg-secondary/30 animate-pulse" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-card bg-secondary/20 border border-primary/8 p-4">
          <div className="min-w-0">
            <p className="typo-body font-medium text-foreground/85">{s.cloud_sync_toggle}</p>
            <p className="typo-caption text-foreground mt-0.5">
              {enabled ? s.cloud_sync_on : s.cloud_sync_off}
            </p>
          </div>
          <AccessibleToggle
            checked={enabled}
            onChange={() => {
              void onToggle();
            }}
            disabled={busy}
            label={s.cloud_sync_toggle_aria}
          />
        </div>
      )}

      {enabled && (
        <>
          {/* Action row + lifetime summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className={`w-4 h-4 ${syncing || status?.syncing ? 'animate-spin' : ''}`} />}
              onClick={() => {
                void onSyncNow();
              }}
              disabled={syncing || status?.syncing}
            >
              {syncing || status?.syncing ? s.cloud_sync_syncing : s.cloud_sync_now}
            </Button>
            <span className="typo-caption text-foreground inline-flex items-center gap-1">
              {status?.lastSyncAt ? (
                <>
                  {s.cloud_sync_last} <RelativeTime timestamp={status.lastSyncAt} />
                </>
              ) : (
                s.cloud_sync_never
              )}
            </span>
            {!!status?.rowsSyncedLast && (
              <span className="typo-caption text-foreground inline-flex items-center gap-1">
                <span aria-hidden>·</span>
                <Numeric><SpringCount value={Number(status.rowsSyncedLast)} /></Numeric> {s.cloud_sync_rows}
              </span>
            )}
            {!!status?.totalRowsSynced && (
              <span className="typo-caption text-foreground inline-flex items-center gap-1">
                <span aria-hidden>·</span>
                <Numeric><SpringCount value={Number(status.totalRowsSynced)} /></Numeric> {s.cloud_sync_total}
              </span>
            )}
          </div>

          {/* Device chip */}
          {status?.deviceId && (
            <Tooltip content={status.deviceId}>
              <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
                <MonitorSmartphone className="w-3.5 h-3.5" />
                {interpolate(s.cloud_sync_device, { id: status.deviceId.slice(0, 8) })}
              </span>
            </Tooltip>
          )}

          {/* Per-table breakdown (collapsible) */}
          {tables.length > 0 && (
            <div className="rounded-card border border-primary/8 bg-secondary/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="flex w-full items-center justify-between px-4 py-2.5 typo-caption font-medium text-foreground hover:bg-secondary/20 transition-colors"
              >
                <span>{s.cloud_sync_tables_title}</span>
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  {showDetails ? s.cloud_sync_hide_details : s.cloud_sync_show_details}
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              <AnimatePresence initial={false}>
                {showDetails && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <ul className="divide-y divide-primary/8 border-t border-primary/8">
                      {tables.map((tbl) => (
                        <li
                          key={tbl.table}
                          className="flex items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="typo-caption font-medium text-foreground truncate">
                            {tableLabels[tbl.table] ?? tbl.table}
                          </span>
                          {tbl.error ? (
                            <span className="inline-flex items-center gap-1.5 typo-caption text-red-400/90 min-w-0">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate max-w-[14rem]">{tbl.error}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 typo-caption text-foreground whitespace-nowrap">
                              <span className="text-foreground inline-flex items-center gap-1">
                                <Numeric value={Number(tbl.rowsLast)} /> {s.cloud_sync_rows}
                              </span>
                              <span aria-hidden>·</span>
                              {tbl.lastSyncedAt ? (
                                <RelativeTime timestamp={tbl.lastSyncedAt} />
                              ) : (
                                <span>{s.cloud_sync_table_pending}</span>
                              )}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Pass-level error + retry */}
          {hasError && (
            <div className="flex items-start gap-2.5 rounded-card border border-red-500/20 bg-red-500/5 p-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="typo-caption text-red-300/90">
                  {interpolate(s.cloud_sync_error, { error: status?.lastError ?? '' })}
                </p>
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => {
                    void onSyncNow();
                  }}
                  disabled={syncing || status?.syncing}
                >
                  {s.cloud_sync_retry}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
