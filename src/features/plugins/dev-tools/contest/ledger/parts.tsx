// Small pieces every level of the ledger draws: a seat as one inline unit, a
// key cap, a phase dot, a variant still, and the clock running seats tick on.
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { ContestEngine } from '@/lib/bindings/ContestEngine';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { StatusVariant } from '@/features/shared/components/display/StatusBadge';

import { formatCost } from '@/lib/utils/formatters';

import { bucketTone, effortLabel, engineLabel, phaseTone, seatStateTone } from '../model/labels';
import { seatLabel } from '../model/seatCatalog';

/** A status tone as the CSS colour the stylesheet mixes (`--t`, `--b`). */
export function toneVar(tone: StatusVariant): string {
  switch (tone) {
    case 'success': return 'var(--status-success)';
    case 'warning': return 'var(--status-warning)';
    case 'error': return 'var(--status-error)';
    case 'info': return 'var(--status-info)';
    case 'processing': return 'var(--status-processing)';
    default: return 'var(--status-neutral)';
  }
}

export const phaseColor = (phase: ContestPhase): string => toneVar(phaseTone(phase));
export const seatColor = (state: ContestSeatState): string => toneVar(seatStateTone(state));
export const bucketColor = (bucket: ContestReviewBucket | null): string => (bucket ? toneVar(bucketTone(bucket)) : 'var(--muted)');

/** A custom property for an inline style (`--t`, `--b`, `--mw`, …). */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  // INVARIANT: every key is a `--name` custom property, which React passes through as-is.
  return vars as CSSProperties;
}

// The dot names the ENGINE, so it takes the categorical brand hues, never a
// status tone (the row's phase dot owns those).
const ENGINE_COLOR: Record<ContestEngine, string> = {
  claude: 'var(--brand-purple)',
  codex: 'var(--brand-cyan)',
  grok: 'var(--foreground)',
};

export const engineColor = (engine: ContestEngine | null): string => (engine ? ENGINE_COLOR[engine] : 'var(--muted)');

/** `claude:claude-opus-5-5@xhigh` as "● Opus 5.5 · Extra high": never a raw spec. */
export function Seat({ spec, quiet = false, hideEffort = false }: { spec: string; quiet?: boolean; hideEffort?: boolean }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const seat = seatLabel(spec);
  return (
    <span className={`seat${quiet ? ' quiet' : ''}`} data-testid="contest-seat-label">
      {seat.engine && <i className="edot" style={{ background: engineColor(seat.engine) }} aria-hidden />}
      {seat.engine && <span className="sr-only">{engineLabel(s, seat.engine)}</span>}
      <span className="seat-m">{seat.model}</span>
      {!hideEffort && seat.effort && (
        <span className="seat-e">
          {' · '}
          {effortLabel(s, seat.effort)}
          {seat.label ? ` #${seat.label}` : ''}
        </span>
      )}
    </span>
  );
}

/**
 * A translated sentence with rich values in it: `{seat} is {elapsed} into
 * {title}` with `seat` a bold name. The template stays whole, so a language can
 * reorder the parts; `{name}` without a value is left as written.
 */
export function Rich({ template, values }: { template: string; values: Record<string, ReactNode> }) {
  const parts = template.split(/(\{\w+\})/);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{(\w+)\}$/.exec(p);
        if (m && m[1]! in values) return <Fragment key={i}>{values[m[1]!]}</Fragment>;
        return p ? <Fragment key={i}>{p}</Fragment> : null;
      })}
    </>
  );
}

/** A seat as plain words, "Opus 5.5 · Extra high", for a sentence that already has a dot. */
export function SeatText({ spec }: { spec: string }) {
  const { t } = useTranslation();
  const seat = seatLabel(spec);
  const effort = seat.effort ? effortLabel(t.plugins.contest, seat.effort) : null;
  return <>{effort ? `${seat.model} · ${effort}` : seat.model}</>;
}

/** One key as the owner presses it. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="cl-kbd">{children}</kbd>;
}

export function PhaseDot({ phase }: { phase: ContestPhase }) {
  return <i className="tdot" style={cssVars({ '--t': phaseColor(phase) })} aria-hidden />;
}

/** The screenshot a still shows: the visual pass's load shot, else the first. */
export function stillOf(screenshots: readonly string[]): string | null {
  return screenshots.find((u) => u.toLowerCase().endsWith('-load.png')) ?? screenshots[0] ?? null;
}

/** A variant's still, or its key on a blank frame when the pass took none. */
export function Still({ src, label }: { src: string | null; label: string }) {
  if (!src) return <span className="nostill" aria-hidden>{label}</span>;
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />;
}

/**
 * An element's layout box, untransformed. The camera scales a level in and out,
 * and a transform neither fires a ResizeObserver nor belongs in a layout size,
 * so this reads the observer's content box, never getBoundingClientRect.
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The clock running seats tick on: once a second while `active`, never otherwise. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** 2489 → "41m 29s"; 5400 → "1h 30m"; null → "—". */
export function formatDuration(seconds: number | null, withSeconds = true): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (!withSeconds) return `${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** A reported dollar figure (the CLI's number, never an invoice), through the
 *  shared locale-aware formatter; an unknown cost reads "—", never $0. */
export function formatUsd(v: number | null): string {
  return formatCost(v, { precision: 2 });
}

/** Bytes as the gallery prints them: 7,930 or 209.3K. */
export function formatBytes(b: number, language: string): string {
  if (b < 10000) return b.toLocaleString(language);
  return `${(Math.round(b / 100) / 10).toLocaleString(language)}K`;
}

/** An ISO date (`YYYY-MM-DD`) as "Sep 22" in the reader's language. */
export function formatDay(iso: string, language: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(language, { month: 'short', day: 'numeric' }) : iso;
}

export function formatMonth(iso: string, language: string): string {
  const d = new Date(`${iso.slice(0, 7)}-15T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(language, { month: 'long', year: 'numeric' }) : iso;
}

/** A clock time for a scheduled start: "Fri, Sep 25, 10:34 PM". */
export function formatClock(ms: number, language: string): string {
  return new Date(ms).toLocaleString(language, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The drawers take the winner's width (BaseModal's own drawer is 480 px):
 *  700 px, 820 px on a wide window, never wider than the window. */
export function drawerPanelClass(wide: boolean): string {
  return `relative h-full ${wide ? 'w-[820px]' : 'w-[700px]'} max-w-[100vw] border-l border-primary/20 shadow-elevation-4 overflow-hidden flex flex-col`;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
