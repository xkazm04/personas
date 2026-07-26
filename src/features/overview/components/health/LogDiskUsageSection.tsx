import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getLogDirectoryStats, type LogDirectoryStats } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { HEALTH_GHOST_BAR, HEALTH_GHOST_WIDTHS } from './healthPanelConstants';

function formatBytes(bytes: number | bigint): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function LogDiskUsageSection() {
  const { t, tx } = useTranslation();
  const [stats, setStats] = useState<LogDirectoryStats | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLogDirectoryStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((err) => {
        silentCatch('LogDiskUsageSection.getLogDirectoryStats')(err);
        if (!cancelled) setUnavailable(true);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <div className="w-6 h-6 rounded-card flex items-center justify-center bg-cyan-500/10">
          <HardDrive className="w-3.5 h-3.5 text-cyan-300" />
        </div>
        <span className="typo-label text-foreground">
          {t.system_health.log_disk_usage}
        </span>
      </div>

      <div className="border-t border-primary/5 px-4 py-3 space-y-2">
        {unavailable && (
          <p className="typo-body text-foreground">{t.system_health.log_disk_unavailable}</p>
        )}
        {!unavailable && stats === null && <LogDiskGhost />}
        {!unavailable && stats && (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="typo-body text-foreground">{t.system_health.log_disk_tracing}</span>
              <span className="typo-code text-foreground">
                {formatBytes(stats.log_bytes)}
                <span className="text-foreground ml-2">
                  {tx(t.system_health.log_disk_files_count, { count: stats.log_file_count })}
                </span>
              </span>
            </div>
            <p className="typo-body text-foreground">
              {tx(t.system_health.log_disk_retention_hint, { limit: stats.tracing_log_retention })}
            </p>

            <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-primary/5">
              <span className="typo-body text-foreground">{t.system_health.log_disk_crashes}</span>
              <span className="typo-code text-foreground">
                {formatBytes(stats.crash_bytes)}
                <span className="text-foreground ml-2">
                  {tx(t.system_health.log_disk_files_count, { count: stats.crash_file_count })}
                </span>
              </span>
            </div>
            <p className="typo-body text-foreground">
              {tx(t.system_health.log_disk_crash_retention_hint, { limit: stats.crash_log_retention })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LogDiskGhost — calm placeholder matching the two-row (bytes + retention
// hint) x two-block (log / crash) geometry of the real content, shown only
// while the stats fetch is in flight (docs/design/overview-loading.md §C).
// ---------------------------------------------------------------------------
function LogDiskGhost() {
  return (
    <div aria-hidden="true">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`h-3 ${HEALTH_GHOST_WIDTHS[0]} ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '120ms' }} />
        <span className={`h-3 w-16 ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '120ms' }} />
      </div>
      <p className="mt-1.5">
        <span className={`block h-2.5 ${HEALTH_GHOST_WIDTHS[1]} ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '155ms' }} />
      </p>
      <div className="flex items-baseline justify-between gap-2 pt-2 mt-2 border-t border-primary/5">
        <span className={`h-3 ${HEALTH_GHOST_WIDTHS[2]} ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '190ms' }} />
        <span className={`h-3 w-16 ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '190ms' }} />
      </div>
      <p className="mt-1.5">
        <span className={`block h-2.5 ${HEALTH_GHOST_WIDTHS[0]} ${HEALTH_GHOST_BAR} animate-fade-in`} style={{ animationDelay: '225ms' }} />
      </p>
    </div>
  );
}
