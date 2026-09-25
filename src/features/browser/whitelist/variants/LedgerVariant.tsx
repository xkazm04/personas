/**
 * Whitelist variant A — the ledger.
 *
 * One dense row per origin, the shape an operator auditing a gate wants: every
 * site's tier, scan state, write policy, credential and enabled switch on one
 * line, sortable, with the three row actions at the end. `UnifiedTable` brings
 * the ghost-under-header loading state, the settled-only empty state and the
 * row-entrance cascade, so none of that is hand-rolled here.
 */
import { ExternalLink, ScanSearch, Check } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserSite } from '../../types';
import { CredentialChip, PatternChip, ScanChip, TierChip, WritesChip } from '../SiteChips';
import type { WhitelistVariantProps } from './variantProps';

export default function LedgerVariant({
  sites,
  loading,
  onToggle,
  onScan,
  onConfirm,
  onRemove,
  onOpen,
  onEdit,
}: WhitelistVariantProps) {
  const { t } = useTranslation();
  const w = t.browser.whitelist;

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
      sortFn: (a, b) => (a.scan_tier ?? -1) - (b.scan_tier ?? -1),
      render: (site) => <TierChip tier={site.scan_tier} />,
    },
    {
      key: 'scan',
      label: w.col_scan,
      width: '130px',
      sortable: true,
      render: (site) => <ScanChip status={site.scan_status} />,
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
        <div className="flex items-center justify-end gap-1.5">
          <AsyncButton
            size="xs"
            variant="ghost"
            icon={<ScanSearch className="w-3.5 h-3.5" />}
            onClick={() => onScan(site)}
            disabled={site.scan_status === 'running'}
            loadingText={w.scan_running}
          >
            {site.scan_status === 'none' ? w.action_scan : w.action_rescan}
          </AsyncButton>
          {site.scan_status === 'proposed' && (
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
          <button
            type="button"
            onClick={() => onEdit(site)}
            className="typo-caption text-foreground hover:text-foreground focus-ring rounded-interactive px-1.5 py-0.5"
          >
            {w.action_edit}
          </button>
          <AsyncButton size="xs" variant="ghost" onClick={() => onRemove(site)}>
            {w.action_remove}
          </AsyncButton>
        </div>
      ),
    },
  ];

  return (
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
      emptyTitle={w.empty_title}
      emptyDescription={w.empty_description}
    />
  );
}
