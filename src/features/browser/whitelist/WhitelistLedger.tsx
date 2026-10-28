/**
 * The whitelist ledger: one dense row per origin, the shape an operator
 * auditing a gate wants. Every site's tier, scan state, write policy,
 * credential and enabled switch on one line, sortable, with the row actions at
 * the end. `UnifiedTable` brings the ghost-under-header loading state, the
 * settled-only empty state and the row-entrance cascade, so none of that is
 * hand-rolled here.
 *
 * It was one of three layouts behind a switcher until spark server-control
 * (2026-10-05) kept it as the only one; Edit opens the site modal, which now
 * carries the credential, the budget and the ask-first overrides too.
 */
import { useState } from 'react';
import { ExternalLink, ScanSearch, Check } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { TableActions } from '@/features/shared/components/display/TableCells';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserSite } from '../types';
import { CredentialChip, PatternChip, ScanChip, TierChip, WritesChip } from './SiteChips';

export interface WhitelistLedgerProps {
  sites: readonly BrowserSite[];
  /** True only while the FIRST read is in flight: a refetch never ghosts rows. */
  loading: boolean;
  onToggle: (site: BrowserSite) => Promise<void>;
  onScan: (site: BrowserSite) => Promise<void>;
  onConfirm: (site: BrowserSite) => Promise<void>;
  onRemove: (site: BrowserSite) => Promise<void>;
  onOpen: (site: BrowserSite) => Promise<void>;
  onEdit: (site: BrowserSite) => void;
}

export default function WhitelistLedger({
  sites,
  loading,
  onToggle,
  onScan,
  onConfirm,
  onRemove,
  onOpen,
  onEdit,
}: WhitelistLedgerProps) {
  const { t, tx } = useTranslation();
  const w = t.browser.whitelist;
  // Remove drops the origin, its overrides and its credential binding with no
  // undo, so it asks first (a wildcard row revokes access to many sites).
  const [pendingRemove, setPendingRemove] = useState<BrowserSite | null>(null);

  const columns: TableColumn<BrowserSite>[] = [
    {
      key: 'origin',
      label: w.col_site,
      width: 'minmax(220px, 2fr)',
      sortable: true,
      render: (site) => (
        <div className="min-w-0" data-testid={`whitelist-row-${site.origin}`}>
          <div className="typo-body text-foreground truncate">{site.label || site.origin}</div>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="typo-caption text-foreground font-mono truncate">{site.origin}</div>
            <PatternChip origin={site.origin} />
          </div>
        </div>
      ),
    },
    {
      key: 'tier',
      label: w.col_tier,
      width: '120px',
      sortable: true,
      sortFn: (a, b) => (a.scanTier ?? -1) - (b.scanTier ?? -1),
      render: (site) => <TierChip tier={site.scanTier} />,
    },
    {
      key: 'scan',
      label: w.col_scan,
      width: '130px',
      sortable: true,
      render: (site) => <ScanChip status={site.scanStatus} />,
    },
    {
      key: 'writes',
      label: w.col_writes,
      width: '120px',
      render: (site) => <WritesChip site={site} />,
    },
    {
      key: 'credential',
      label: w.col_credential,
      width: '130px',
      render: (site) => <CredentialChip site={site} />,
    },
    {
      key: 'enabled',
      label: w.col_enabled,
      width: '100px',
      render: (site) => (
        <AccessibleToggle
          checked={site.enabled}
          onChange={() => void onToggle(site)}
          label={w.enabled_label}
          size="sm"
          data-testid={`whitelist-toggle-${site.origin}`}
        />
      ),
    },
    {
      key: 'actions',
      label: w.col_actions,
      width: 'minmax(230px, 1fr)',
      align: 'right',
      render: (site) => (
        <TableActions>
          <AsyncButton
            size="xs"
            variant="ghost"
            icon={<ScanSearch className="w-3.5 h-3.5" />}
            onClick={() => onScan(site)}
            disabled={site.scanStatus === 'running'}
            loadingText={w.scan_running}
          >
            {site.scanStatus === 'none' ? w.action_scan : w.action_rescan}
          </AsyncButton>
          {site.scanStatus === 'proposed' && (
            <AsyncButton
              size="xs"
              variant="accent"
              tone="success"
              icon={<Check className="w-3.5 h-3.5" />}
              onClick={() => onConfirm(site)}
            >
              {w.action_confirm}
            </AsyncButton>
          )}
          <AsyncButton
            size="xs"
            variant="ghost"
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            onClick={() => onOpen(site)}
            disabled={!site.enabled}
            disabledReason={w.open_needs_enabled}
          >
            {w.action_open}
          </AsyncButton>
          <Button size="xs" variant="ghost" onClick={() => onEdit(site)} data-testid={`whitelist-edit-${site.origin}`}>
            {t.browser.add_site.edit_action}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setPendingRemove(site)}
            data-testid={`whitelist-remove-${site.origin}`}
          >
            {w.action_remove}
          </Button>
        </TableActions>
      ),
    },
  ];

  return (
    <>
      <UnifiedTable<BrowserSite>
        columns={columns}
        data={sites as BrowserSite[]}
        getRowKey={(site) => site.origin}
        isLoading={loading}
        // Windowed: the whitelist is a gate, and a gate an agent can ask to
        // extend has no natural ceiling on how many origins it holds.
        rowHeight={56}
        density="compact"
        defaultSortKey="origin"
        defaultSortDir="asc"
        ariaLabel={w.table_aria}
        emptyArt="shield"
        emptyTitle={w.empty_title}
        emptyDescription={w.empty_description}
      />
      {pendingRemove && (
        <ConfirmDialog
          danger
          title={w.action_remove}
          body={tx(w.remove_body, { origin: pendingRemove.origin })}
          confirmLabel={w.action_remove}
          onConfirm={async () => {
            const site = pendingRemove;
            setPendingRemove(null);
            await onRemove(site);
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </>
  );
}
