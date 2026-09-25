/**
 * The right pane of the master-detail Whitelist variant: one origin, five
 * tabs, and the row actions in its header.
 *
 * Splitting the tabs into their own modules keeps every file under the repo's
 * 200-LOC component ceiling and means the Policy and Login tabs — the two that
 * actually WRITE — can be read on their own.
 */
import { useState } from 'react';
import { Check, ExternalLink, ScanSearch } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';

import type { BrowserSite } from '../../types';
import ControlMeter from '../ControlMeter';
import ScanReport from '../ScanReport';
import { CredentialChip, WritesChip } from '../SiteChips';
import HandsTab from './HandsTab';
import LoginTab from './LoginTab';
import PageToolsTab from './PageToolsTab';
import PolicyTab from './PolicyTab';

type DetailTab = 'overview' | 'tools' | 'hands' | 'login' | 'policy';

interface SiteDetailPaneProps {
  site: BrowserSite;
  onToggle: (site: BrowserSite) => Promise<void>;
  onScan: (site: BrowserSite) => Promise<void>;
  onConfirm: (site: BrowserSite) => Promise<void>;
  onRemove: (site: BrowserSite) => Promise<void>;
  onOpen: (site: BrowserSite) => Promise<void>;
  onEdit: (site: BrowserSite) => void;
}

export default function SiteDetailPane({
  site,
  onToggle,
  onScan,
  onConfirm,
  onRemove,
  onOpen,
  onEdit,
}: SiteDetailPaneProps) {
  const { t } = useTranslation();
  const w = t.browser.whitelist;
  const d = t.browser.detail;
  const [tab, setTab] = useState<DetailTab>('overview');

  return (
    <div className="flex flex-col min-w-0">
      <div className={`${CARD_PADDING.standard} border-b border-primary/10 flex items-start gap-3 min-w-0`}>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onEdit(site)}
            className="typo-heading text-foreground truncate block text-left hover:underline focus-ring rounded-interactive"
          >
            {site.label || site.origin}
          </button>
          <div className="typo-caption text-foreground font-mono truncate">{site.origin}</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <ControlMeter tier={site.scan_tier} />
            <WritesChip site={site} />
            <CredentialChip site={site} />
          </div>
        </div>
        <AccessibleToggle
          checked={site.enabled}
          onChange={() => void onToggle(site)}
          label={w.enabled_label}
          size="sm"
          data-testid={`whitelist-toggle-${site.origin}`}
        />
      </div>

      <div className="px-4">
        <PanelTabBar<DetailTab>
          tabs={[
            { id: 'overview', label: d.tab_overview },
            { id: 'tools', label: d.tab_page_tools },
            { id: 'hands', label: d.tab_hands },
            { id: 'login', label: d.tab_login },
            { id: 'policy', label: d.tab_policy },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          underlineClass="bg-primary"
          idPrefix={`browser-detail-${site.origin}`}
        />
      </div>

      {/* The region PanelTabBar's `aria-controls` already points at. Without
          these three attributes the tab strip advertises a relationship to a
          panel that no element claims to be. */}
      <div
        role="tabpanel"
        id={`browser-detail-${site.origin}-panel-${tab}`}
        aria-labelledby={`browser-detail-${site.origin}-tab-${tab}`}
        className={CARD_PADDING.standard}
      >
        {tab === 'overview' && <ScanReport report={site.scan_report} />}
        {tab === 'tools' && <PageToolsTab site={site} />}
        {tab === 'hands' && <HandsTab site={site} />}
        {tab === 'login' && <LoginTab site={site} />}
        {tab === 'policy' && <PolicyTab site={site} />}
      </div>

      <div className={`${CARD_PADDING.standard} border-t border-primary/10 flex items-center justify-end gap-1.5`}>
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
        <AsyncButton size="xs" variant="ghost" onClick={() => onRemove(site)}>
          {w.action_remove}
        </AsyncButton>
      </div>
    </div>
  );
}
