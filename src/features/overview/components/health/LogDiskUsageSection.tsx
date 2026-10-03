import { useEffect, useState } from 'react';

import { getLogDirectoryStats, type LogDirectoryStats } from '@/api/system/system';
import { KeyValueGrid, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

function formatBytes(bytes: number | bigint): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * What the logs weigh, as a level-2 kit `Section` (kit batch home-3).
 *
 * It used to be a hand-rolled boxed card (`rounded-modal border bg-secondary/20`) with a
 * `cyan-500/10` badge, a hand-rolled ghost of six positioned bars and four rows of prose. It is
 * now the kit: two facts in a `KeyValueGrid`, the two retention rules as the section's `desc`, and
 * the section's own `loading` ghost. Its fetch is its own, so its placeholder is retired by its
 * own data and it never waits on a health check (`overview-loading.md` law 6).
 */
export function LogDiskUsageSection() {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const [stats, setStats] = useState<LogDirectoryStats | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLogDirectoryStats()
      .then((next) => { if (!cancelled) setStats(next); })
      .catch((err) => {
        silentCatch('LogDiskUsageSection.getLogDirectoryStats')(err);
        if (!cancelled) setUnavailable(true);
      });
    return () => { cancelled = true; };
  }, []);

  const state = unavailable ? 'empty' : stats === null ? 'loading' : undefined;

  return (
    <Section
      level={2}
      title={s.log_disk_usage}
      state={state}
      ghostRows={2}
      empty={{ title: s.log_disk_unavailable }}
      // Not the kit's `Meta`: it joins its parts with `.k-sep`, which carries no margin of its
      // own, so two adjacent string parts render glued to the dot ("...10 files·Capped at..."). A
      // kit finding, recorded for the Director rather than worked around inside the kit.
      desc={stats
        ? `${tx(s.log_disk_retention_hint, { limit: stats.tracing_log_retention })} · ${tx(s.log_disk_crash_retention_hint, { limit: stats.crash_log_retention })}`
        : undefined}
    >
      {stats && (
        <KeyValueGrid
          min="14rem"
          items={[
            {
              k: s.log_disk_tracing,
              v: `${formatBytes(stats.log_bytes)} · ${tx(s.log_disk_files_count, { count: stats.log_file_count })}`,
            },
            {
              k: s.log_disk_crashes,
              v: `${formatBytes(stats.crash_bytes)} · ${tx(s.log_disk_files_count, { count: stats.crash_file_count })}`,
            },
          ]}
        />
      )}
    </Section>
  );
}
