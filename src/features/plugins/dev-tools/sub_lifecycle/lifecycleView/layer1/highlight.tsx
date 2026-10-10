/**
 * The verdict highlight shared by the status band's verdict counts and the
 * rail: resting on a count (pointer or focus) PREVIEWS that verdict's steps,
 * pressing it PINS the highlight, pressing again or Esc clears it. While a
 * verdict is highlighted, every other card dims its surface (never its text).
 *
 * A preview wins over a pin while it lasts, so sweeping the counts reads each
 * verdict in turn and leaving the counts returns to the pinned one.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

export interface Highlight {
  /** The verdict the rail shows highlighted now (preview over pin); null when none. */
  active: LifecycleHealth | null;
  pinned: LifecycleHealth | null;
  preview: (health: LifecycleHealth | null) => void;
  toggle: (health: LifecycleHealth) => void;
  clear: () => void;
}

const NONE: Highlight = { active: null, pinned: null, preview: () => {}, toggle: () => {}, clear: () => {} };

const HighlightContext = createContext<Highlight>(NONE);

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<LifecycleHealth | null>(null);
  const [previewed, setPreviewed] = useState<LifecycleHealth | null>(null);

  const toggle = useCallback((h: LifecycleHealth) => setPinned((p) => (p === h ? null : h)), []);
  const clear = useCallback(() => { setPinned(null); setPreviewed(null); }, []);

  // Esc clears a pinned highlight from anywhere on the page, on the app's
  // keyboard ladder at the default rung (a modal or the palette above it keeps
  // its Esc), and only while something is pinned.
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return false;
    clear();
    return true;
  }, { enabled: pinned !== null });

  const value = useMemo<Highlight>(
    () => ({ active: previewed ?? pinned, pinned, preview: setPreviewed, toggle, clear }),
    [previewed, pinned, toggle, clear],
  );
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

/** The highlight in force (a no-op highlight outside a provider). */
export function useHighlight(): Highlight {
  return useContext(HighlightContext);
}

/** How a card reads under the highlight: `on` (its verdict is highlighted), `off` (dimmed) or `none`. */
export function highlightOf(active: LifecycleHealth | null, health: LifecycleHealth): 'on' | 'off' | 'none' {
  if (!active) return 'none';
  return active === health ? 'on' : 'off';
}
