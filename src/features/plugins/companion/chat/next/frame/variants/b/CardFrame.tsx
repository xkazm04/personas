/**
 * The Gwent-style card pieces for Halo · Rows.
 *
 * - `CardFrame`: the layered border every card wears. Outer dark keyline, a
 *   metallic ring cut from the kind colour (a sheen gradient mixed toward the
 *   foreground and the background), an engraved inner line in the kind colour
 *   and four corner studs. The kind colour arrives as a CSS variable, so the
 *   same frame serves every kind.
 * - `CardPortrait`: the art window, the kind glyph large over a gradient, with
 *   the card's number in a strength gem.
 * - `NamePlate`: the banner that carries the title across the portrait's foot.
 * - `MiniCard`: the same frame at board-row size, face up.
 */

import type { CSSProperties, ReactNode } from 'react';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { NEXT_COPY as C } from '../../../nextCopy';
import { CARD_GLYPH } from './glyphs';

const HEX = 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)';

function metal(color: string): string {
  return `linear-gradient(145deg,
    color-mix(in srgb, var(--foreground) 55%, ${color}) 0%,
    ${color} 16%,
    color-mix(in srgb, var(--background) 60%, ${color}) 38%,
    color-mix(in srgb, var(--foreground) 30%, ${color}) 56%,
    ${color} 70%,
    color-mix(in srgb, var(--background) 55%, ${color}) 100%)`;
}

export function CardFrame({
  color,
  size = 'full',
  className = '',
  style,
  children,
}: {
  color: string;
  size?: 'full' | 'mini';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const full = size === 'full';
  return (
    <div
      className={`relative ${full ? 'p-[4px] rounded-card' : 'p-[2px] rounded-interactive'} ${className}`}
      style={{
        background: metal(color),
        boxShadow: full
          ? `0 0 0 1.5px var(--background), 0 30px 70px -24px color-mix(in srgb, ${color} 55%, transparent), 0 12px 30px -12px color-mix(in srgb, var(--background) 80%, transparent)`
          : `0 0 0 1px var(--background), 0 8px 18px -10px color-mix(in srgb, ${color} 60%, transparent)`,
        ...style,
      }}
    >
      <div
        className={`relative h-full w-full overflow-hidden ${full ? 'rounded-[9px]' : 'rounded-[4px]'} bg-background`}
        style={{
          boxShadow: full
            ? `inset 0 0 0 1px color-mix(in srgb, ${color} 70%, transparent), inset 0 0 0 5px var(--background), inset 0 0 0 6px color-mix(in srgb, ${color} 28%, transparent)`
            : `inset 0 0 0 1px color-mix(in srgb, ${color} 55%, transparent)`,
        }}
      >
        {children}
      </div>
      {full && <CornerStuds color={color} />}
    </div>
  );
}

function CornerStuds({ color }: { color: string }) {
  const stud = 'absolute w-2.5 h-2.5 rotate-45 border border-background';
  const style = { background: metal(color) };
  return (
    <>
      <span className={`${stud} -top-1 -left-1`} style={style} aria-hidden />
      <span className={`${stud} -top-1 -right-1`} style={style} aria-hidden />
      <span className={`${stud} -bottom-1 -left-1`} style={style} aria-hidden />
      <span className={`${stud} -bottom-1 -right-1`} style={style} aria-hidden />
    </>
  );
}

/** A number in a hexagon, Gwent's strength corner. */
export function StrengthMark({ n, color, big = false }: { n: number; color: string; big?: boolean }) {
  return (
    <span
      className={`grid place-items-center tabular-nums text-foreground ${big ? 'w-9 h-10 typo-section-title' : 'w-5 h-5 typo-caption'}`}
      style={{
        clipPath: HEX,
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 70%, var(--background)), color-mix(in srgb, ${color} 25%, var(--background)))`,
      }}
    >
      {n}
    </span>
  );
}

export function CardPortrait({ item, n }: { item: WorkItem; n: number }) {
  const color = KIND_VAR[item.kind];
  const Glyph = CARD_GLYPH[item.kind];
  return (
    <div
      className="relative h-[clamp(76px,12vh,128px)] shrink-0 grid place-items-center overflow-hidden"
      style={{
        background: `radial-gradient(circle at 50% 62%, color-mix(in srgb, ${color} 46%, transparent), transparent 68%),
          linear-gradient(180deg, color-mix(in srgb, ${color} 16%, var(--secondary)), var(--background))`,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          background: `repeating-linear-gradient(135deg, transparent 0 10px, color-mix(in srgb, ${color} 10%, transparent) 10px 11px)`,
        }}
      />
      <Glyph
        aria-hidden
        className="relative w-[clamp(40px,7vh,64px)] h-[clamp(40px,7vh,64px)]"
        strokeWidth={1.5}
        style={{ color, filter: `drop-shadow(0 6px 14px color-mix(in srgb, ${color} 55%, transparent))` }}
      />
      <span className="absolute top-2.5 left-2.5">
        <StrengthMark n={n} color={color} big />
      </span>
      {item.project && (
        <span className="absolute top-3 right-3 max-w-[50%] truncate rounded-interactive border border-foreground/15 bg-background/80 px-2 py-0.5 typo-caption text-foreground">
          {item.project}
        </span>
      )}
    </div>
  );
}

export function NamePlate({ item }: { item: WorkItem }) {
  const color = KIND_VAR[item.kind];
  return (
    <div className="relative -mt-5 mx-3 shrink-0">
      <div
        className="px-5 py-2"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 97% 50%, 100% 100%, 0 100%, 3% 50%)',
          background: `linear-gradient(180deg, color-mix(in srgb, ${color} 42%, var(--secondary)), color-mix(in srgb, ${color} 18%, var(--background)))`,
        }}
      >
        <p className="typo-label uppercase tracking-wider text-center" style={{ color: `color-mix(in srgb, ${color} 55%, var(--foreground))` }}>
          {C.kind[item.kind]}
        </p>
        <h2 className="typo-section-title text-foreground text-center leading-snug line-clamp-2">{item.title}</h2>
      </div>
    </div>
  );
}

/** A face-up card at board-row size. */
export function MiniCard({ item, n, dim = false }: { item: WorkItem; n: number; dim?: boolean }) {
  const color = KIND_VAR[item.kind];
  const Glyph = CARD_GLYPH[item.kind];
  return (
    <CardFrame color={color} size="mini" className={`w-[52px] h-[72px] ${dim ? 'opacity-40' : ''}`}>
      <div
        className="h-full grid place-items-center"
        style={{ background: `radial-gradient(circle at 50% 55%, color-mix(in srgb, ${color} 34%, transparent), transparent 72%)` }}
      >
        <Glyph className="w-6 h-6" strokeWidth={1.75} style={{ color }} aria-hidden />
      </div>
      <span className="absolute top-0.5 left-0.5">
        <StrengthMark n={n} color={color} />
      </span>
    </CardFrame>
  );
}
