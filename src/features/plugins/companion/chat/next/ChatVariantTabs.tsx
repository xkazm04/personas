/**
 * ChatVariantTabs — the throwaway /prototype switcher for the Athena chat.
 *
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher. The owner
 * picks a winner (or a fusion) from these variants; the winner becomes the only
 * render and this file, the store below and the losing variants are deleted in
 * the same commit.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

export type ChatVariant = 'current' | 'spread';

export const useChatVariantStore = create<{ variant: ChatVariant; set: (v: ChatVariant) => void }>((set) => ({
  variant: 'spread',
  set: (variant) => set({ variant }),
}));

const TABS: { id: ChatVariant; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'spread', label: 'Halo · Spread' },
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
