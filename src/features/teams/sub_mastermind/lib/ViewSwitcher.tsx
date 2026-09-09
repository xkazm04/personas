// Canvas header — the view switcher between the shipped 2D Hex Mosaic
// (baseline) and the three 3D prototypes. Sits top-centre on the canvas
// chrome; the prototypes are being auditioned side by side, so the switch has
// to be one click from any of them.
import type { ReactNode } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import type { WorldVariant } from '../three/palettes';

/** `board` is the Strata design board — a dev-only contact sheet of look
 *  recipes (three/board). It never appears in a production build. */
export type MastermindView = 'baseline' | WorldVariant | 'board';

export const MASTERMIND_VIEWS: MastermindView[] = ['baseline', 'strata', 'holo', ...(import.meta.env.DEV ? (['board'] as const) : [])];

/** Shared by the strip and its panel so every tab's aria-controls resolves. */
const ID_PREFIX = 'mm-view';

export function ViewSwitcher({ view, onChange }: { view: MastermindView; onChange: (v: MastermindView) => void }) {
  const { t } = useTranslation();
  const tabs = [
    { id: 'baseline' as const, label: t.mastermind.view_baseline },
    { id: 'strata' as const, label: t.mastermind.view_strata },
    { id: 'holo' as const, label: t.mastermind.view_holo },
    ...(import.meta.env.DEV ? [{ id: 'board' as const, label: t.mastermind.view_board }] : []),
  ];
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 p-1 rounded-interactive mm-chrome surface-blur-tooltip" data-testid="mm-view-switcher">
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
