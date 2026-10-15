import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Measure } from './geometry';

/** The canvas cannot read CSS variables: the inks it paints with, resolved from the theme. */
export interface Ink { accent: string; fg: string; muted: string; mfg: string; err: string; warn: string; primary: string }

export interface StageEnv {
  W: number;
  H: number;
  /** The map's base type size in px (the app's body step at the current text scale). */
  fs: number;
  ink: Ink;
  measure: Measure;
  reduce: boolean;
}

const INK_VARS: Record<keyof Ink, string> = {
  accent: '--accent', fg: '--foreground', muted: '--muted', mfg: '--muted-foreground',
  err: '--status-error', warn: '--status-warning', primary: '--primary',
};

function readInk(probe: HTMLElement): Ink {
  const out = {} as Ink;
  for (const [k, v] of Object.entries(INK_VARS) as [keyof Ink, string][]) {
    probe.style.color = `var(${v})`;
    out[k] = getComputedStyle(probe).color;
  }
  return out;
}

const sameInk = (a: Ink, b: Ink) => (Object.keys(INK_VARS) as (keyof Ink)[]).every((k) => a[k] === b[k]);

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/**
 * Follow the stage: its size (ResizeObserver, coalesced to one frame), the type size and inks of
 * the current theme and text scale (a MutationObserver on <html>, where both are set), and the
 * reduced-motion preference. Each change is one state update; nothing here runs per frame.
 */
export function useStageEnv(stage: RefObject<HTMLElement | null>, probe: RefObject<HTMLElement | null>): StageEnv | null {
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  const [theme, setTheme] = useState<{ fs: number; family: string; ink: Ink } | null>(null);
  const [reduce, setReduce] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const W = Math.round(el.clientWidth), H = Math.round(el.clientHeight);
      setSize((s) => (s && Math.abs(s.W - W) < 2 && Math.abs(s.H - H) < 2 ? s : { W, H }));
    };
    read();
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(read); });
    ro.observe(el);
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [stage]);

  useEffect(() => {
    const p = probe.current;
    if (!p) return;
    const read = () => {
      const cs = getComputedStyle(p);
      const next = { fs: parseFloat(cs.fontSize) || 16, family: cs.fontFamily, ink: readInk(p) };
      setTheme((t) => (t && t.fs === next.fs && t.family === next.family && sameInk(t.ink, next.ink) ? t : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-text-scale', 'data-lang'] });
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduce(mq.matches);
    mq.addEventListener('change', onMq);
    return () => { mo.disconnect(); mq.removeEventListener('change', onMq); };
  }, [probe]);

  const measure = useMemo<Measure>(() => {
    const family = theme?.family ?? 'sans-serif';
    return (text, px, weight = 400, trackEm = 0) => {
      if (!ctx) return text.length * px * 0.55;
      ctx.font = `${weight} ${px}px ${family}`;
      return ctx.measureText(text).width + trackEm * px * text.length;
    };
  }, [theme?.family]);

  return useMemo(
    () => (size && theme && size.W > 0 && size.H > 0 ? { ...size, fs: theme.fs, ink: theme.ink, measure, reduce } : null),
    [size, theme, measure, reduce],
  );
}
