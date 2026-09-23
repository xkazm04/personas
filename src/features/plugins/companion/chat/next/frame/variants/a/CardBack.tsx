/**
 * CardBack — the one card-back of Halo · Hand, at three sizes: the board's
 * mini deck, a card in the hand, and the full card's reverse face during the
 * flip. Gold rim, a deep primary→purple field with a woven lozenge pattern
 * (pure CSS gradients, no image, no noise) and Athena's owl-eye sigil in the
 * middle. A thin kind-coloured inner edge says what kind of card it is.
 */

import type { CSSProperties } from 'react';
import { GOLD, GOLD_DEEP, GOLD_SOFT } from './handTokens';

type Size = 'mini' | 'hand' | 'fill';

const DIMS: Record<Exclude<Size, 'fill'>, { w: number; h: number; rim: number; radius: string }> = {
  mini: { w: 22, h: 30, rim: 1.5, radius: 'rounded-[4px]' },
  hand: { w: 84, h: 118, rim: 3, radius: 'rounded-[10px]' },
};

const FIELD =
  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-amber) 10%, transparent) 0 1px, transparent 1px 9px),' +
  'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--brand-amber) 10%, transparent) 0 1px, transparent 1px 9px),' +
  'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--primary) 45%, var(--background)), color-mix(in srgb, var(--brand-purple) 35%, var(--background)) 70%)';

export function CardBackFace({ kindColor, size, className = '', style }: {
  kindColor: string;
  size: Size;
  className?: string;
  style?: CSSProperties;
}) {
  const dims = size === 'fill' ? null : DIMS[size];
  const rim = dims?.rim ?? 4;
  return (
    <span
      className={`block ${dims?.radius ?? 'rounded-[18px]'} ${size === 'fill' ? 'w-full h-full' : ''} ${className}`}
      style={{
        width: dims?.w,
        height: dims?.h,
        padding: rim,
        background: `linear-gradient(150deg, ${GOLD}, ${GOLD_DEEP} 45%, ${GOLD} 80%, ${GOLD_DEEP})`,
        boxShadow: size === 'mini' ? '0 1px 2px color-mix(in srgb, var(--background) 60%, transparent)' : undefined,
        ...style,
      }}
      aria-hidden
    >
      <span
        className={`relative grid place-items-center w-full h-full overflow-hidden ${
          size === 'mini' ? 'rounded-[3px]' : size === 'hand' ? 'rounded-[7px]' : 'rounded-[14px]'
        }`}
        style={{ background: FIELD, boxShadow: `inset 0 0 0 ${size === 'mini' ? 1 : 1.5}px ${kindColor}` }}
      >
        {size !== 'mini' && <Sigil big={size === 'fill'} />}
      </span>
    </span>
  );
}

/** A lozenge with an eye: Athena's owl, reduced to two strokes. */
function Sigil({ big }: { big: boolean }) {
  const s = big ? 96 : 34;
  return (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" aria-hidden>
      <path d="M20 3 L37 20 L20 37 L3 20 Z" stroke={GOLD} strokeWidth="1.6" />
      <path d="M20 9 L31 20 L20 31 L9 20 Z" stroke={GOLD_SOFT} strokeWidth="1" />
      <path d="M11 20 Q20 12 29 20 Q20 28 11 20 Z" stroke={GOLD} strokeWidth="1.4" />
      <circle cx="20" cy="20" r="3" fill={GOLD} />
    </svg>
  );
}
