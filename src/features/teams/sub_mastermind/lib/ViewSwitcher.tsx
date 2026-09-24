// Canvas header — the view switcher between the shipped 2D Hex Mosaic
// (Baseline) and Soundings, the next-gen chart the owner picked from the
// 2026-09 contest (docs/design/mastermind-soundings.md). Both stay one click
// apart until Soundings is fine-tuned.
//
// Floating (top-centre over the Baseline canvas) or inline (inside Soundings'
// own top bar, where a floating strip would cover the reading line).
import type { ReactNode } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

export type MastermindView = 'baseline' | 'soundings';

/** Shared by the strip and its panel so every tab's aria-controls resolves. */
const ID_PREFIX = 'mm-view';

export function ViewSwitcher({ view, onChange, inline = false }: { view: MastermindView; onChange: (v: MastermindView) => void; inline?: boolean }) {
  const { t } = useTranslation();
  const tabs = [
    { id: 'baseline' as const, label: t.mastermind.view_baseline },
    { id: 'soundings' as const, label: t.mastermind.soundings_view },
  ];
  const strip = (
    <SegmentedTabs<MastermindView>
      tabs={tabs}
      activeTab={view}
      onTabChange={onChange}
      variant="segment"
      size="sm"
      fullWidth={false}
      ariaLabel={t.mastermind.view_switcher_label}
      layoutId="mm-view-switcher"
      idPrefix={ID_PREFIX}
    />
  );
  if (inline) return <div className="flex-none" data-testid="mm-view-switcher">{strip}</div>;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 p-1 rounded-interactive mm-chrome surface-blur-tooltip" data-testid="mm-view-switcher">
      {strip}
    </div>
  );
}

/** The region the switcher selects — wraps whichever canvas is showing, so the
 *  tab strip's aria-controls points at a real element (golden path: tab-strip). */
export function ViewPanel({ view, children }: { view: MastermindView; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${ID_PREFIX}-panel-${view}`} aria-labelledby={`${ID_PREFIX}-tab-${view}`} className="absolute inset-0">
      {children}
    </div>
  );
}
