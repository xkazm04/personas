import { useEffect, useState, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { storageUsage, pruneStorage, reclaimStorage } from '@/api/system/system';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';
import type { StorageReport } from '@/lib/bindings/StorageReport';
import type { PruneResult } from '@/lib/bindings/PruneResult';
import type { ReclaimResult } from '@/lib/bindings/ReclaimResult';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** How many casualty tables the confirm names explicitly (the rest fold into
 *  the total) — the technique wants the LARGEST groups called out, not a wall. */
const NAMED_CASUALTIES = 3;

/** "table (rows)" for the biggest casualty groups; raw table names on purpose
 *  (code identifiers, not translatable copy). */
function casualtySummary(res: PruneResult): string {
  return res.casualties
    .slice(0, NAMED_CASUALTIES)
    .map((c) => `${c.table} (${Number(c.rows)})`)
    .join(', ');
}

function StatCell({ label, value, caption }: { label: string; value: ReactNode; caption?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="typo-caption text-foreground">{label}</dt>
      <dd className="typo-body text-foreground">{value}</dd>
      {caption && <dd className="typo-caption text-foreground">{caption}</dd>}
    </div>
  );
}

/**
 * F18: local storage footprint + safe cleanup. Shows the whole footprint the
 * app keeps beside its database — the database (with the free pages a
 * compaction would give back), backups and logs — and how many finished runs
 * are removable. Header is provided by the surrounding SettingsScaffold
 * section; this renders content only.
 *
 * Both actions follow one contract: an ENFORCEMENT-PATH dry-run arms the
 * confirm, and the act reports its receipt through the same accounting.
 *
 * - Prune (deferred-fixes #31): `pruneStorage(dryRun: true)` executes the real
 *   cascade inside a rolled-back transaction, so the dialog names the true
 *   blast radius — total rows and the largest casualty tables — not a count on
 *   the target table that a cascade silently multiplies (measured 3.29× on this
 *   machine).
 * - Reclaim: `reclaimStorage(true)` reads the freelist the compaction will give
 *   back at least; the act runs the VACUUM and reports before → after.
 *
 * A failed preview never arms a confirm (a broken preview must not read as
 * "safe").
 */
export function StorageUsageSection() {
  const { t, tx } = useTranslation();
  const tp = t.settings.portability;
  const [report, setReport] = useState<StorageReport | null>(null);
  const [preview, setPreview] = useState<PruneResult | null>(null);
  const [receipt, setReceipt] = useState<PruneResult | null>(null);
  const [reclaimPreview, setReclaimPreview] = useState<ReclaimResult | null>(null);
  const [reclaimReceipt, setReclaimReceipt] = useState<ReclaimResult | null>(null);

  const refresh = () => {
    storageUsage().then(setReport).catch(toastCatch('StorageUsageSection:fetch'));
  };
  useEffect(refresh, []);

  const onArmConfirm = async () => {
    try {
      // The zero-caller dry-run, wired in: preview THROUGH the delete's path.
      const res = await pruneStorage(undefined, true);
      setPreview(res);
    } catch (e) {
      toastCatch('StorageUsageSection:preview')(e);
    }
  };

  const onPrune = async () => {
    try {
      const res = await pruneStorage(undefined, false);
      setReceipt(res);
      setPreview(null);
      refresh();
    } catch (e) {
      toastCatch('StorageUsageSection:prune')(e);
    }
  };

  const onArmReclaim = async () => {
    try {
      const res = await reclaimStorage(true);
      setReclaimReceipt(null);
      setReclaimPreview(res);
    } catch (e) {
      toastCatch('StorageUsageSection:reclaimPreview')(e);
    }
  };

  const onReclaim = async () => {
    try {
      const res = await reclaimStorage(false);
      setReclaimReceipt(res);
      setReclaimPreview(null);
      refresh();
    } catch (e) {
      toastCatch('StorageUsageSection:reclaim')(e);
    }
  };

  const canPrune = report != null && Number(report.prunableExecutions) > 0 && !preview;
  const canReclaim = report != null && report.databaseFreeBytes > 0 && !reclaimPreview;

  return (
    <div className="flex flex-col gap-3">
      {report && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCell
            label={tp.storage_db_size}
            value={formatBytes(Number(report.databaseBytes) + report.walBytes)}
          />
          <StatCell label={tp.storage_db_free} value={formatBytes(report.databaseFreeBytes)} />
          <StatCell
            label={tp.storage_backups}
            value={formatBytes(report.backupsBytes)}
            caption={tx(tp.storage_backup_sets, { count: report.backupSets })}
          />
          <StatCell
            label={tp.storage_logs}
            value={formatBytes(report.logsBytes)}
            caption={tx(tp.storage_files_count, { count: report.logFiles })}
          />
          <StatCell
            label={tp.storage_total}
            value={<Numeric value={Number(report.totalExecutions)} unit="count" />}
          />
          <StatCell
            label={tp.storage_removable}
            value={<Numeric value={Number(report.prunableExecutions)} unit="count" />}
          />
        </dl>
      )}

      {(canPrune || canReclaim) && (
        <div className="flex flex-wrap items-center gap-2">
          {canPrune && (
            <AsyncButton variant="secondary" onClick={onArmConfirm}>
              {tp.storage_prune}
            </AsyncButton>
          )}
          {canReclaim && (
            <AsyncButton variant="secondary" onClick={onArmReclaim}>
              {tp.storage_reclaim}
            </AsyncButton>
          )}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-2">
          <span className="typo-body text-foreground">
            {tx(tp.storage_confirm, { count: Number(preview.prunedExecutions) })}
          </span>
          <span className="typo-caption text-foreground">
            {tx(tp.storage_cascade_note, {
              total: Number(preview.totalRows),
              tables: preview.casualties.length,
            })}
            {preview.casualties.length > 0 && <> {casualtySummary(preview)}</>}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton variant="danger" onClick={onPrune}>
              {tp.storage_confirm_yes}
            </AsyncButton>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {receipt != null && (
        <p className="typo-caption text-foreground">
          {tx(tp.storage_pruned, { count: Number(receipt.prunedExecutions) })}{' '}
          {tx(tp.storage_cascade_note, {
            total: Number(receipt.totalRows),
            tables: receipt.casualties.length,
          })}
        </p>
      )}

      {reclaimPreview && (
        <div className="flex flex-col gap-2">
          <span className="typo-body text-foreground">
            {tx(tp.storage_reclaim_confirm, { size: formatBytes(reclaimPreview.reclaimableBytes) })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton variant="primary" onClick={onReclaim}>
              {tp.storage_reclaim_confirm_yes}
            </AsyncButton>
            <Button variant="ghost" onClick={() => setReclaimPreview(null)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {reclaimReceipt != null && (
        <p className="typo-caption text-foreground">
          {tx(tp.storage_reclaimed, {
            before: formatBytes(reclaimReceipt.databaseBytesBefore),
            after: formatBytes(reclaimReceipt.databaseBytesAfter),
          })}
        </p>
      )}
    </div>
  );
}
