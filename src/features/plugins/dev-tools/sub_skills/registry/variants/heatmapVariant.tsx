// TEMPORARY — /contest scaffold (2026-09-21). Three takes on the Registry
// heatmap live side by side under variants/ (current = master before the
// contest, opus = Claude Opus 5 xhigh, grok = Grok 4.6 high), and one switch
// flips them everywhere at once: the Dev Tools Registry tab and the Fleet
// dock's skill picker read the same module-level choice (in memory only — it
// resets to Opus on reload, which is fine for a comparison that lives days).
// Once a winner is picked, the losing folders, this file, the two host
// wrappers and the losers' i18n keys are deleted, and the winner moves back
// up to registry/.
import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';

/** Contestant ids — not model choices (hence not bare model names). */
export type HeatmapVariant = 'current' | 'opus5' | 'grok46';

// Proper names of the contestants, not product copy — the scaffold is deleted
// with the losers, so these never reach the i18n catalogs.
const TABS: Array<{ id: HeatmapVariant; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'opus5', label: 'Opus 5 · xhigh' },
  { id: 'grok46', label: 'Grok 4.6 · high' },
];

let current: HeatmapVariant = 'opus5';
const listeners = new Set<() => void>();

function setVariant(v: HeatmapVariant) {
  current = v;
  listeners.forEach((l) => l());
}

function useHeatmapVariant(): HeatmapVariant {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
  );
}

/** The switch plus the region it swaps, declared as its tabpanel. */
export function HeatmapVariantFrame({ children, isolateSwitch = false, className = '' }: {
  children: (variant: HeatmapVariant) => ReactNode;
  /** Keep switch presses from reaching a document-level click-outside. */
  isolateSwitch?: boolean;
  className?: string;
}) {
  const variant = useHeatmapVariant();
  const prefix = `heatmap-variant-${useId()}`;
  return (
    <div className={`flex min-h-0 flex-col gap-1.5 ${className}`}>
      <div className="flex flex-shrink-0 justify-end" onMouseDown={isolateSwitch ? (e) => e.stopPropagation() : undefined}>
        <SegmentedTabs
          tabs={TABS}
          activeTab={variant}
          onTabChange={setVariant}
          size="sm"
          fullWidth={false}
          idPrefix={prefix}
          ariaLabel="Heatmap variant"
        />
      </div>
      <div {...segmentedTabPanelProps(prefix, variant)} role="tabpanel" className="min-h-0 flex-1">
        {children(variant)}
      </div>
    </div>
  );
}
