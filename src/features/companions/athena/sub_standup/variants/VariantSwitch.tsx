/**
 * TODO(prototype, 2026-11-06): consolidate the Standup layout switcher. Throwaway
 * A/B strip for the in-app prototype round; deleted with the losing variants.
 */
import { useCallback, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type LayoutVariant = 'ledger' | 'console' | 'editorial' | 'studio';

const KEY = 'personas.athena.standup.variant';
const ALL: readonly LayoutVariant[] = ['ledger', 'console', 'editorial', 'studio'];
const LABELS: Record<LayoutVariant, string> = {
  ledger: 'V1 Ledger (round 1)',
  console: 'R2-A Console',
  editorial: 'R2-B Editorial',
  studio: 'R2-C Studio',
};

export function useLayoutVariant(): [LayoutVariant, (v: LayoutVariant) => void] {
  const [v, setV] = useState<LayoutVariant>(() => {
    const saved = safeLocalGet(KEY, 'standup variant read') as LayoutVariant | null;
    return saved && ALL.includes(saved) ? saved : 'ledger';
  });
  const set = useCallback((next: LayoutVariant) => { setV(next); safeLocalSet(KEY, next, 'standup variant write'); }, []);
  return [v, set];
}

export function VariantSwitch({ value, onChange }: { value: LayoutVariant; onChange: (v: LayoutVariant) => void }) {
  return (
    <div className="flex justify-center px-4 py-2 border-b border-primary/10">
      <SegmentedTabs
        tabs={ALL.map((id) => ({ id, label: <span className="whitespace-nowrap">{LABELS[id]}</span>, testId: `standup-variant-${id}` }))}
        activeTab={value}
        onTabChange={onChange}
        size="sm"
        layoutId="standup-variant-switch"
        ariaLabel="Standup prototype variant"
      />
    </div>
  );
}
