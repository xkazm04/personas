// The instruments' canvases (groove, spread rows, bezel) paint with the same
// tokens as the stylesheet. A token can be a `color-mix()` chain a 2D context
// cannot parse, so each is resolved through a probe inside the stage, exactly
// as the engine's own theme reader does (`engine/theme.ts`), and re-read per
// theme flip rather than per frame.
import { useEffect, useState, type RefObject } from 'react';

import { useThemeStore } from '@/stores/themeStore';

export interface InstrumentColors {
  light: boolean;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  purple: string;
  star: string;
  ok: string;
  err: string;
  warn: string;
  none: string;
  font: string;
}

/** Resolve every instrument colour through a probe inside the stage. */
export function readInstrumentColors(stage: HTMLElement): InstrumentColors {
  const root = document.documentElement;
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  stage.appendChild(probe);
  const pick = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const colors: InstrumentColors = {
    light: (root.dataset.theme ?? '').startsWith('light'),
    bg: pick('--background'),
    fg: pick('--foreground'),
    muted: pick('--muted'),
    accent: pick('--accent'),
    purple: pick('--brand-purple'),
    star: pick('--gx-star'),
    ok: pick('--gx-ok'),
    err: pick('--gx-err'),
    warn: pick('--gx-warn'),
    none: pick('--gx-none'),
    font: getComputedStyle(stage).fontFamily,
  };
  probe.remove();
  return colors;
}

/**
 * The instrument colours, re-read when the theme flips (the same two signals
 * and the same settle delay as the field's own theme reader), held in React
 * state so every canvas repaints from one read rather than one per frame.
 */
export function useInstrumentColors(stageRef: RefObject<HTMLElement | null>, mounted: boolean): InstrumentColors | null {
  const [colors, setColors] = useState<InstrumentColors | null>(null);
  useEffect(() => {
    let timer = 0;
    const read = () => {
      const stage = stageRef.current;
      if (!stage) return;
      setColors(readInstrumentColors(stage));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => stageRef.current && setColors(readInstrumentColors(stageRef.current)), 300);
    };
    read();
    const unsubscribe = useThemeStore.subscribe(read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-brightness', 'data-contrast'] });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      unsubscribe();
    };
  }, [stageRef, mounted]);
  return colors;
}

/** `rgb(r, g, b)` at an alpha, for gradients that fall off like starlight. */
export function alpha(color: string, a: number): string {
  const n = color.match(/-?[\d.]+/g);
  if (!n || n.length < 3) return color;
  return `rgba(${n[0]}, ${n[1]}, ${n[2]}, ${a})`;
}

/** A care cell's tone token (`var(--gx-*)`) as a canvas colour. */
export function toneColor(c: InstrumentColors, token: string): string {
  if (token.includes('gx-ok')) return c.ok;
  if (token.includes('gx-err')) return c.err;
  if (token.includes('gx-warn')) return c.warn;
  return c.none;
}
