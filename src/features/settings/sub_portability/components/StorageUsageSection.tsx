import { useEffect, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { storageUsage, pruneStorage } from '@/api/system/system';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';
import type { StorageReport } from '@/lib/bindings/StorageReport';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * F18: local storage usage + safe prune. Shows the operational DB size and how
 * many finished runs are removable, with a two-step confirm before deleting
 * (the backend additionally enforces dry-run default, a 24h floor, and a
 * terminal-only allow-list).
 */
export function StorageUsageSection() {
  const { t, tx } = useTranslation();
  const tp = t.settings.portability;
  const [report, setReport] = useState<StorageReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pruned, setPruned] = useState<number | null>(null);

  const refresh = () => {
    storageUsage().then(setReport).catch(toastCatch('StorageUsageSection:fetch'));
  };
  useEffect(refresh, []);

  const onPrune = async () => {
    try {
      const res = await pruneStorage(undefined, false);
      setPruned(Number(res.prunedExecutions));
      setConfirming(false);
      refresh();
    } catch (e) {
      toastCatch('StorageUsageSection:prune')(e);
    }
  };

  return (
    <section className="rounded-card border border-border/40 bg-secondary/30 p-4 flex flex-col gap-3">
      <header>
        <h3 className="typo-title text-primary">{tp.storage_title}</h3>
        <p className="typo-caption text-foreground">{tp.storage_subtitle}</p>
      </header>

      {report && (
        <dl className="grid grid-cols-3 gap-3">
          <div className="flex flex-col">
            <dt className="typo-caption text-foreground">{tp.storage_db_size}</dt>
            <dd className="typo-body text-foreground">{formatBytes(Number(report.databaseBytes))}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="typo-caption text-foreground">{tp.storage_total}</dt>
            <dd className="typo-body text-foreground">
              <Numeric value={Number(report.totalExecutions)} unit="count" />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="typo-caption text-foreground">{tp.storage_removable}</dt>
            <dd className="typo-body text-foreground">
              <Numeric value={Number(report.prunableExecutions)} unit="count" />
            </dd>
          </div>
        </dl>
      )}

      {report && Number(report.prunableExecutions) > 0 && !confirming && (
        <div>
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {tp.storage_prune}
          </Button>
        </div>
      )}

      {report && confirming && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="typo-body text-foreground">
            {tx(tp.storage_confirm, { count: Number(report.prunableExecutions) })}
          </span>
          <AsyncButton variant="danger" onClick={onPrune}>
            {tp.storage_confirm_yes}
          </AsyncButton>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t.common.cancel}
          </Button>
        </div>
      )}

      {pruned != null && (
        <p className="typo-caption text-foreground">{tx(tp.storage_pruned, { count: pruned })}</p>
      )}
    </section>
  );
}
