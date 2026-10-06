import { useEffect, useState } from 'react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { silentCatch } from '@/lib/silentCatch';

// PROTOTYPE SCAFFOLD (throwaway, DEV-only): A/B switcher for the footer
// variants. Deleted in the consolidation step with every losing variant.
// TODO(prototype, 2026-10-06): consolidate DesktopFooter switcher.

export type FooterVariantId = 'baseline' | 'console' | 'dock' | 'rail';

const KEY = 'proto-footer-variant';
const EVENT = 'proto-footer-variant';

const TABS: { id: FooterVariantId; label: string }[] = [
  { id: 'baseline', label: 'Baseline' },
  { id: 'console', label: '1 Console' },
  { id: 'dock', label: '2 Status Dock' },
  { id: 'rail', label: '3 Signal Rail' },
];

function read(): FooterVariantId {
  try {
    const v = localStorage.getItem(KEY);
    return TABS.some((t) => t.id === v) ? (v as FooterVariantId) : 'baseline';
  } catch { return 'baseline'; }
}

export function useFooterVariant(): FooterVariantId {
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
}

function choose(v: FooterVariantId) {
  try { localStorage.setItem(KEY, v); } catch (err) { silentCatch('footer/variants/switcher:persist')(err); }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function FooterVariantSwitcher({ active }: { active: FooterVariantId }) {
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[220] bg-background rounded-card shadow-elevation-3"
      style={{ bottom: 'calc(var(--desktop-footer-h, 32px) + 8px)' }} data-testid="footer-variant-switcher">
      <SegmentedTabs tabs={TABS} activeTab={active} onTabChange={choose} size="sm" ariaLabel="Footer variant" />
    </div>
  );
}
