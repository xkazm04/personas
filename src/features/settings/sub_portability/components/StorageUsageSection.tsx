import { useEffect, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { storageUsage, pruneStorage } from '@/api/system/system';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';
import type { StorageReport } from '@/lib/bindings/StorageReport';
import type { PruneResult } from '@/lib/bindings/PruneResult';

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

/**
 * F18: local storage usage + safe prune. Shows the operational DB size and how
 * many finished runs are removable, with a two-step confirm before deleting
 * (the backend additionally enforces dry-run default, a 24h floor, and a
 * terminal-only allow-list). Header is provided by the surrounding
 * SettingsScaffold section; this renders content only.
 *
 * The confirm is armed by the ENFORCEMENT-PATH dry-run (deferred-fixes #31):
 * `pruneStorage(dryRun: true)` executes the real cascade inside a rolled-back
 * transaction, so the dialog names the true blast radius — total rows and the
 * largest casualty tables — not a count on the target table that a cascade
 * silently multiplies (measured 3.29× on this machine). The act runs the same
 * path committed and reports its receipt through the same accounting. A failed
 * preview never arms the confirm (a broken preview must not read as "safe").
 */
export function StorageUsageSection() {
  const { t, tx } = useTranslation();
  const tp = t.settings.portability;
  const [report, setReport] = useState<StorageReport | null>(null);
  const [preview, setPreview] = useState<PruneResult | null>(null);
  const [receipt, setReceipt] = useState<PruneResult | null>(null);

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

  return (
    <div className="flex flex-col gap-3">
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

      {report && Number(report.prunableExecutions) > 0 && !preview && (
        <div>
          <AsyncButton variant="secondary" onClick={onArmConfirm}>
            {tp.storage_prune}
          </AsyncButton>
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
    </div>
  );
}
