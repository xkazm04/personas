/**
 * Whitelist variant C — master / detail.
 *
 * The list stays thin and the right pane carries everything a single origin is
 * worth saying: what the scan found, which tools the page publishes, what the
 * generic hands can do, whether a vault credential is bound, and the policy
 * the operator has tightened. This is the variant for deciding about ONE site;
 * the ledger is for scanning across them.
 */
import { useEffect, useState } from 'react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import SiteDetailPane from '../detail/SiteDetailPane';
import { PatternChip, ScanChip, TierChip } from '../SiteChips';
import type { WhitelistVariantProps } from './variantProps';

function ListGhost() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded-card bg-secondary/20 border border-primary/10" />
      ))}
    </div>
  );
}

export default function MasterDetailVariant({
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
  const [selected, setSelected] = useState<string | null>(null);

  // Follow the rows: the first load picks a site, and a site that disappears
  // (deleted here or by another session) releases the pane instead of pinning
  // it to a row that no longer exists.
  useEffect(() => {
    if (sites.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((current) =>
      current && sites.some((site) => site.origin === current) ? current : (sites[0]?.origin ?? null),
    );
  }, [sites]);

  if (loading && sites.length === 0) return <ListGhost />;
  if (sites.length === 0) {
    return <EmptyState title={w.empty_title} description={w.empty_description} />;
  }

  const active = sites.find((site) => site.origin === selected) ?? null;

  return (
    <div className="flex gap-4 min-h-0 items-start">
      <div className="w-64 shrink-0 space-y-1.5" role="list">
        {sites.map((site) => (
          <button
            key={site.origin}
            type="button"
            role="listitem"
            onClick={() => setSelected(site.origin)}
            data-testid={`whitelist-row-${site.origin}`}
            className={[
              'w-full text-left px-3 py-2 rounded-card border transition-colors focus-ring min-w-0',
              site.origin === selected
                ? 'border-primary/30 bg-primary/10'
                : 'border-primary/10 bg-secondary/20 hover:border-primary/20',
            ].join(' ')}
          >
            <div className="typo-body text-foreground truncate">{site.label || site.origin}</div>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="typo-caption text-foreground font-mono truncate">{site.origin}</div>
              <PatternChip origin={site.origin} />
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <TierChip tier={site.scan_tier} />
              <ScanChip status={site.scan_status} />
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 rounded-card border border-primary/10 bg-secondary/20">
        {active ? (
          <SiteDetailPane
            site={active}
            onToggle={onToggle}
            onScan={onScan}
            onConfirm={onConfirm}
            onRemove={onRemove}
            onOpen={onOpen}
            onEdit={onEdit}
          />
        ) : (
          <div className="p-6">
            <EmptyState title={w.select_site} />
          </div>
        )}
      </div>
    </div>
  );
}
