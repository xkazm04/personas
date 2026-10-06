/**
 * ChatVariantTabs — the Athena chat's variant switcher.
 *
 * FILAMENT WON the `athena-chrome` contest (owner, 2026-10-06) and is the
 * DEFAULT now. It had been reachable on master since `657b361397` - the tab was
 * here, the files were here, `ChatVariantHost` dispatched to it - but the store
 * below opened on `spread` and holds no persistence, so every launch and every
 * reload put Spread on screen. A winner you have to go and click, every time,
 * is not a winner the app ships.
 *
 * `current` and `spread` stay selectable at the owner's instruction: he is
 * setting up a separate project to fuse them with Filament, and deleting them
 * now would delete the inputs to that fusion. This is the one case where
 * keeping the losing variants alive is the explicit ask rather than the usual
 * rot - so it is recorded here, not assumed.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

export type ChatVariant = 'current' | 'spread' | 'filament';

export const useChatVariantStore = create<{ variant: ChatVariant; set: (v: ChatVariant) => void }>((set) => ({
  // The winner, so it is what the app opens on. Deliberately NOT persisted to
  // Web Storage: the default is now the thing you want, which is what made the
  // missing persistence a problem in the first place, and a storage site here
  // would be one the golden path then has to route somewhere
  // (`raw-web-storage`).
  variant: 'filament',
  set: (variant) => set({ variant }),
}));

// Winner first: the strip reads left-to-right as what ships, then the two kept
// for the fusion project.
const TABS: { id: ChatVariant; label: string; testId: string }[] = [
  { id: 'filament', label: 'Filament', testId: 'chat-variant-filament' },
  { id: 'current', label: 'Current', testId: 'chat-variant-current' },
  { id: 'spread', label: 'Halo · Spread', testId: 'chat-variant-spread' },
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
