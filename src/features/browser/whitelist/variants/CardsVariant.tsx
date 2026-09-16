/**
 * Whitelist variant B — cards.
 *
 * One tile per origin, sized for the question "how much can an agent do
 * here?" rather than "what does every column say?": the control meter leads,
 * the scan findings sit inline underneath, and the switch and actions close
 * the card. Loading is a geometry-matched ghost UNDER the grid — never a
 * spinner, and never a replacement for the grid itself.
 */
import { Check, ExternalLink, ScanSearch } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';

import ControlMeter from '../ControlMeter';
import ScanReport from '../ScanReport';
import { CredentialChip, ScanChip, WritesChip } from '../SiteChips';
import type { WhitelistVariantProps } from './variantProps';

const GRID = 'grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3';

function CardGhost() {
  return (
    <div className={GRID} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`${CARD_PADDING.standard} rounded-card border border-primary/10 bg-secondary/20 h-44`}
        />
      ))}
    </div>
  );
}

export default function CardsVariant({
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
  // Keyed on the row set so a refetch that returns the same origins does NOT
  // replay the cascade — a fetch is not an entrance.
  const reveal = useRevealTracker(sites.length);

  if (loading && sites.length === 0) return <CardGhost />;
  if (sites.length === 0) {
    return <EmptyState title={w.empty_title} description={w.empty_description} />;
  }

  return (
    <div className={GRID}>
      {sites.map((site, index) => (
        <RevealItem
          key={site.origin}
          revealId={site.origin}
          order={index}
          hasEntered={reveal.hasEntered}
          markEntered={reveal.markEntered}
          className={`${CARD_PADDING.standard} rounded-card border border-primary/10 bg-secondary/20 flex flex-col gap-3 min-w-0`}
          data-testid={`whitelist-row-${site.origin}`}
        >
          <div className="flex items-start gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onEdit(site)}
                className="typo-heading-sm text-foreground truncate block text-left hover:underline focus-ring rounded-interactive"
              >
                {site.label || site.origin}
              </button>
              <div className="typo-caption text-foreground font-mono truncate">{site.origin}</div>
            </div>
            <AccessibleToggle
              checked={site.enabled}
              onChange={() => void onToggle(site)}
              label={w.enabled_label}
              size="sm"
              data-testid={`whitelist-toggle-${site.origin}`}
            />
          </div>

          <ControlMeter tier={site.scan_tier} />

          <div className="flex flex-wrap items-center gap-1.5">
            <ScanChip status={site.scan_status} />
            <WritesChip site={site} />
            <CredentialChip site={site} />
          </div>

          <div className="border-t border-primary/10 pt-3">
            <ScanReport report={site.scan_report} compact />
          </div>

          <div className="flex items-center justify-end gap-1.5 mt-auto">
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
                accentColor="emerald"
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
        </RevealItem>
      ))}
    </div>
  );
}
