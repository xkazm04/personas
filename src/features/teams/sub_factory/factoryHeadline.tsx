// The Factory page header's finding line. A layer deep inside the Factory can
// lift one sentence into the page's own header band (the Passport Atlas does:
// "24 projects · 7 below 45% of their golden standard · ..."), and it is
// cleared when that layer unmounts, so no other layer inherits a stale line.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface FactoryHeadline { eyebrow: string; title: string }

const Ctx = createContext<((h: FactoryHeadline | null) => void) | null>(null);

export function useFactoryHeadlineState(): [FactoryHeadline | null, (h: FactoryHeadline | null) => void] {
  return useState<FactoryHeadline | null>(null);
}

export function FactoryHeadlineProvider({ set, children }: { set: (h: FactoryHeadline | null) => void; children: ReactNode }) {
  return <Ctx.Provider value={set}>{children}</Ctx.Provider>;
}

/** Show `headline` in the page header while the caller is mounted (null = the page's own title). */
export function useFactoryHeadline(headline: FactoryHeadline | null): void {
  const set = useContext(Ctx);
  const eyebrow = headline?.eyebrow;
  const title = headline?.title;
  useEffect(() => {
    if (!set) return;
    set(eyebrow != null && title != null ? { eyebrow, title } : null);
  }, [set, eyebrow, title]);
  useEffect(() => () => set?.(null), [set]);
}
