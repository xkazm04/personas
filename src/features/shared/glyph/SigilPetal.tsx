import { memo } from 'react';
import type { GlyphDimension, GlyphPresence } from './types';
import { DIM_META, PETAL_ANGLES } from './dimMeta';

interface SigilPetalProps {
  dim: GlyphDimension;
  presence: GlyphPresence;
  index: number;
  size: number;
  rowId: string;
  rowIndex: number;
  glowId: string;
  petalPath: string;
  petalPathDashed: string;
  isHovered: boolean;
  isActive: boolean;
  dimOther: boolean;
  onHover: (dim: GlyphDimension | null) => void;
  onClick: (dim: GlyphDimension) => void;
  /** Roving-tabindex value — 0 for the current tab stop, -1 otherwise. */
  tabIndex: number;
  /** Localized "{label}: {state}" announced to screen readers. */
  ariaLabel: string;
  /** Render the keyboard focus ring (the petal is the focused tab stop). */
  isFocused: boolean;
  /** Keyboard handler — parent owns arrow/Home/End/Enter/Space routing.
   *  Passed stable + re-bound with `dim` here so the memo stays effective. */
  onKeyDown: (e: React.KeyboardEvent, dim: GlyphDimension) => void;
  onFocusDim: (dim: GlyphDimension) => void;
  registerRef: (dim: GlyphDimension, el: SVGGElement | null) => void;
}

/** Renders a single petal group — body varies by presence state.
 *  The parent <svg> provides the `glowId` filter plus the shared petal paths.
 *  Hit-testing uses the visible path directly because all three shapes share
 *  the same clickable silhouette.
 *
 *  Memoized: hovering one petal in a card with 8 petals would otherwise
 *  re-render the other 7 needlessly (all their hover/active props are stable). */
function SigilPetalImpl({
  dim, presence, index, size, rowId, rowIndex, glowId,
  petalPath, petalPathDashed, isHovered, isActive, dimOther,
  onHover, onClick, tabIndex, ariaLabel, isFocused,
  onKeyDown, onFocusDim, registerRef,
}: SigilPetalProps) {
  const meta = DIM_META[dim];
  const angle = PETAL_ANGLES[dim];
  const center = size / 2;
  const petalOuter = size * 0.44;
  const petalInner = size * 0.14;
  const petalGrad = `sigil-petal-${rowId}-${rowIndex}-${index}`;

  let body: React.ReactNode;
  if (presence === 'none') {
    body = (
      <path
        d={petalPath}
        fill={isHovered ? meta.color : 'transparent'}
        fillOpacity={isHovered ? 0.06 : 0}
        stroke={isHovered ? meta.color : 'currentColor'}
        strokeWidth="1.3"
        strokeOpacity={isHovered ? 0.7 : 0.28}
        strokeDasharray="4,4"
      />
    );
  } else if (presence === 'shared') {
    body = (
      <path
        d={petalPathDashed}
        fill={meta.color}
        fillOpacity={isHovered ? 0.18 : 0.08}
        stroke={meta.color}
        strokeWidth="1.5"
        strokeOpacity={isHovered ? 1 : 0.8}
        strokeDasharray="4,4"
      />
    );
  } else {
    body = (
      <>
        <defs>
          <linearGradient id={petalGrad} x1="0" y1={-petalOuter} x2="0" y2={-petalInner} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={meta.color} stopOpacity={isHovered ? 1 : 0.95} />
            <stop offset="55%" stopColor={meta.color} stopOpacity={isHovered ? 0.75 : 0.6} />
            <stop offset="100%" stopColor={meta.color} stopOpacity={isHovered ? 0.2 : 0.12} />
          </linearGradient>
        </defs>
        <path
          d={petalPath}
          fill={`url(#${petalGrad})`}
          stroke={meta.color}
          strokeWidth={isHovered ? 1.8 : 1.3}
          strokeOpacity="0.95"
          filter={`url(#${glowId})`}
        />
        <circle cx={0} cy={-petalOuter + 8} r={3} fill="#fff" opacity="0.95" />
      </>
    );
  }

  return (
    <g
      ref={(el) => registerRef(dim, el)}
      transform={`translate(${center} ${center}) rotate(${angle})`}
      role="button"
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      style={{
        opacity: dimOther && !isActive ? 0.25 : 1,
        transition: 'opacity 0.25s ease',
        cursor: 'pointer',
        pointerEvents: 'auto',
        outline: 'none',
      }}
      onMouseEnter={() => onHover(dim)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocusDim(dim)}
      onKeyDown={(e) => onKeyDown(e, dim)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(dim);
      }}
    >
      {body}
      {/* Keyboard focus ring — a bright white halo distinct from the
          colored hover treatment, so keyboard focus reads clearly even
          on a lit petal. Driven by parent state, not :focus-visible,
          since SVG outline rendering is unreliable. */}
      {isFocused && (
        <path
          d={petalPath}
          fill="none"
          stroke="#fff"
          strokeWidth={2.5}
          strokeOpacity={0.9}
          filter={`url(#${glowId})`}
        />
      )}
    </g>
  );
}

export const SigilPetal = memo(SigilPetalImpl);
