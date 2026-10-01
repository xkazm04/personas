/**
 * The L2 panel's parts. `PanelGroup` is one titled block; `LegendKey` is a
 * swatch drawn with the same classes as the mark it explains, its label and an
 * optional figure; `ItemRow` is one item that opens L3 (the whole row is the
 * control: Tab, Enter/Space, click) and lights its mark on the ring while
 * hovered or focused. Names wrap; nothing here truncates.
 *
 * ItemRow is not the kit's ListRow on purpose: ListRow is fixed-height (a long
 * goal title would be cut) and has no hover/focus hook for the ring.
 */
import type { KeyboardEvent, ReactNode } from 'react';

import { RadialFigure } from '../RadialFigure';
import type { RadialIds } from '../glyphs/primitives';

/** Joins label parts, dropping any that resolved empty (a key not yet split into the catalog). */
export const joinLabel = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ');

interface PanelGroupProps {
  title: string;
  /** Column heads aligned over the rows' figures (words, or a swatch with an sr-only name). */
  columns?: readonly ReactNode[];
  children: ReactNode;
  testId?: string;
}

export function PanelGroup({ title, columns, children, testId }: PanelGroupProps) {
  return (
    <section className="rd-panel-group" data-testid={testId}>
      <div className="rd-panel-head">
        <h4 className="typo-eyebrow text-primary">{title}</h4>
        {columns?.map((c, i) => (
          <span key={i} className="rd-col typo-caption">
            {c}
          </span>
        ))}
      </div>
      {children}
    </section>
  );
}

export type SwatchKind = 'fill' | 'track' | 'half' | 'await' | 'reject' | 'hatch' | 'spoke' | 'rule' | 'star' | 'tick' | 'dot' | 'dash';

/** A 24 x 14 picture of one mark, painted by the ring's own classes. */
export function Swatch({ kind, ids }: { kind: SwatchKind; ids: RadialIds }) {
  return (
    <svg className="rd-swatch" width="24" height="14" viewBox="0 0 24 14" aria-hidden focusable="false">
      {kind === 'fill' && <rect className="rd-fill" x="1" y="2" width="22" height="10" rx="2" />}
      {kind === 'track' && <rect className="rd-track" x="1" y="2" width="22" height="10" rx="2" />}
      {kind === 'half' && (
        <>
          <rect className="rd-track" x="1" y="2" width="22" height="10" rx="2" />
          <rect className="rd-fill" x="1" y="7" width="22" height="5" rx="1" />
        </>
      )}
      {kind === 'await' && <rect className="rd-await" fill={`url(#${ids.await})`} x="1" y="2" width="22" height="10" rx="2" />}
      {kind === 'reject' && <rect className="rd-reject" x="1.5" y="2.5" width="21" height="9" rx="2" />}
      {kind === 'hatch' && (
        <>
          <rect fill={`url(#${ids.hatch})`} x="1" y="2" width="22" height="10" rx="2" />
          <rect className="rd-dash" x="1" y="2" width="22" height="10" rx="2" />
        </>
      )}
      {kind === 'spoke' && <line className="rd-spoke" x1="2" y1="7" x2="22" y2="7" />}
      {kind === 'rule' && <line className="rd-rule" x1="2" y1="7" x2="22" y2="7" />}
      {kind === 'star' && <polygon className="rd-star" points="12,1 14,5 19,5 15,8 17,13 12,10 7,13 9,8 5,5 10,5" />}
      {kind === 'tick' && [5, 9, 13, 17].map((x) => <line key={x} className="rd-tick" x1={x} y1="2" x2={x} y2="12" />)}
      {kind === 'dot' && <circle className="rd-dot" cx="12" cy="7" r="4.5" />}
      {kind === 'dash' && <line className="rd-spoke is-unvoiced" x1="2" y1="7" x2="22" y2="7" />}
    </svg>
  );
}

interface LegendKeyProps {
  kind: SwatchKind;
  /** A second mark that means the same thing (drawn after the first). */
  also?: SwatchKind;
  ids: RadialIds;
  label: string;
  value?: number | null;
  unit?: 'ratio' | 'count';
  testId?: string;
}

export function LegendKey({ kind, also, ids, label, value, unit, testId }: LegendKeyProps) {
  return (
    <div className="rd-legend-key" data-testid={testId}>
      <Swatch kind={kind} ids={ids} />
      {also && <Swatch kind={also} ids={ids} />}
      <span className="typo-caption">{label}</span>
      {value !== undefined && <RadialFigure value={value} unit={unit} className="typo-data text-foreground" />}
    </div>
  );
}

/** A column head drawn as the legend's own swatch; the words stay for assistive tech. */
export function SwatchHead({ kind, ids, label }: { kind: SwatchKind; ids: RadialIds; label: string }) {
  return (
    <>
      <Swatch kind={kind} ids={ids} />
      <span className="sr-only">{label}</span>
    </>
  );
}

/** One labelled quantity in the panel, not tied to a mark. */
export function StatLine({ label, value, unit, testId }: { label: string; value: number | null; unit?: 'ratio' | 'count'; testId?: string }) {
  return (
    <div className="rd-stat-line" data-testid={testId}>
      <span className="typo-caption">{label}</span>
      <RadialFigure value={value} unit={unit} className="typo-data text-foreground" />
    </div>
  );
}

interface ItemRowProps {
  label: string;
  hot: boolean;
  onHot: (on: boolean) => void;
  onPress: () => void;
  testId?: string;
  children: ReactNode;
}

export function ItemRow({ label, hot, onHot, onPress, testId, children }: ItemRowProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className="rd-row focus-ring"
      data-hot={hot ? 'true' : undefined}
      data-testid={testId}
      onClick={onPress}
      onKeyDown={onKeyDown}
      onPointerEnter={() => onHot(true)}
      onPointerLeave={() => onHot(false)}
      onFocus={() => onHot(true)}
      onBlur={() => onHot(false)}
    >
      {children}
    </div>
  );
}
