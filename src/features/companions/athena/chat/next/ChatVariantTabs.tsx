/**
 * ChatVariantTabs — the Athena chat's variant switcher.
 *
 * FUSION IS THE DEFAULT as of 2026-10-07: the owner reviewed round 5's six
 * variants, liked none of them whole, and named the piece of each he wanted
 * kept - Spread's keyboard decision, Filament's slim rail and toolset,
 * Current's content rendering and managed overview, R5 · A's island, R5 · C's
 * margin count. Fusion is that fusion (`frame/variants/fusion/`), so it is
 * what the app opens on and the first tab.
 *
 * Filament (the `athena-chrome` contest winner, 2026-10-06) and Current stay
 * selectable beside it. Halo · Spread and R5 · A / B / C were deleted the same
 * day at the owner's instruction, once Fusion had taken the parts he wanted
 * from them. The store below holds no persistence, so a default is
 * only a default if it is written here - every launch and every reload opens
 * on it.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

// TODO(prototype, 2026-10-07): athena chat - consolidate Fusion / Filament / Current once the owner settles.
export type ChatVariant = 'fusion' | 'current' | 'filament';

export const useChatVariantStore = create<{ variant: ChatVariant; set: (v: ChatVariant) => void }>((set) => ({
  // The owner's fusion, so it is what the app opens on. Deliberately NOT persisted to
  // Web Storage: the default is now the thing you want, which is what made the
  // missing persistence a problem in the first place, and a storage site here
  // would be one the golden path then has to route somewhere
  // (`raw-web-storage`).
  variant: 'fusion',
  set: (variant) => set({ variant }),
}));

// Fusion first: the strip reads left-to-right as what ships, then what stays
// selectable beside it.
const TABS: { id: ChatVariant; label: string; testId: string }[] = [
  { id: 'fusion', label: 'Fusion', testId: 'chat-variant-fusion' },
  { id: 'filament', label: 'Filament', testId: 'chat-variant-filament' },
  { id: 'current', label: 'Current', testId: 'chat-variant-current' },
];

export function ChatVariantTabs({ lifted }: { lifted: boolean }) {
  const variant = useChatVariantStore((s) => s.variant);
  const set = useChatVariantStore((s) => s.set);
  return (
    <div className={`fixed top-[54px] left-1/2 -translate-x-1/2 ${lifted ? 'z-[230]' : 'z-[70]'} rounded-full bg-background/90 backdrop-blur border border-foreground/15 shadow-elevation-3 p-1`}>
      <SegmentedTabs
        tabs={TABS}
        activeTab={variant}
        onTabChange={set}
        size="sm"
        fullWidth={false}
        ariaLabel="Chat prototype"
        layoutId="athena-chat-variant"
      />
    </div>
  );
}

/** The region the strip swaps: the active variant renders inside it. */
export function ChatVariantPanel({ children }: { children: ReactNode }) {
  const variant = useChatVariantStore((s) => s.variant);
  return (
    <div role="tabpanel" aria-label={TABS.find((x) => x.id === variant)?.label} className="contents">
      {children}
    </div>
  );
}
