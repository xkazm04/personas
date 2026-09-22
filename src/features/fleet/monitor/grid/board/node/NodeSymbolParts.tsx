// NodeSymbolParts — the small pieces a node's symbol row is built from: the
// labelled symbol box, the state mark, the team/project swatch, the unseen-chat
// mark, and the one affordance-button dress every board's wrappers share.

import type { CSSProperties, ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { swatchHue, swatchInitial, type NodeSymbolId, type StateMark } from './nodeSymbols';

/**
 * One AFFORDANCE button, for the wrappers: 16 px to match a symbol, revealed
 * with the cluster, full on its own hover / focus. Owned here so every board's
 * affordances are dressed alike.
 */
export const AFFORDANCE_BTN = 'focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:opacity-25';

const SYMBOL_BOX = 'inline-flex h-4 w-4 flex-shrink-0 items-center justify-center';
export const GLYPH = 'h-2.5 w-2.5 flex-shrink-0';
export const NUMERAL = 'text-[9px] font-bold leading-none tabular-nums';

/** One symbol: an inert labelled box with its tooltip. */
export function Sym({
  id, label, tooltip, className, testId, data, children,
}: {
  id: NodeSymbolId;
  label: string;
  tooltip?: ReactNode;
  className: string;
  testId?: string;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip ?? label}>
      <span role="img" aria-label={label} data-symbol={id} data-testid={testId} {...data} className={`${SYMBOL_BOX} ${className}`}>
        {children}
      </span>
    </Tooltip>
  );
}

/** The state's mark, painted with `currentColor` so the box's class decides its hue. */
export function StateGlyph({ mark, reducedMotion }: { mark: StateMark; reducedMotion: boolean }) {
  switch (mark.kind) {
    case 'pulse':
      return <span aria-hidden className={`h-2 w-2 rounded-full bg-current ${reducedMotion ? '' : 'animate-pulse'}`} />;
    case 'hollow':
      return <span aria-hidden className="h-2 w-2 rounded-full border-[1.5px] border-current" />;
    case 'icon': {
      const Icon = mark.icon;
      return <Icon aria-hidden className={GLYPH} />;
    }
  }
}

/** A 12 px coloured square with the initial letter, hue hashed from the name. */
export function Swatch({ name }: { name: string }) {
  // `--swatch-h` is the ONE value that varies; the classes derive every colour
  // from it, with a darker letter under a light theme.
  const style = { '--swatch-h': swatchHue(name) } as CSSProperties;
  const tone = 'bg-[hsl(var(--swatch-h)_55%_48%)] text-background';
  return (
    <span aria-hidden style={style} className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-none ${NUMERAL} ${tone}`}>
      {swatchInitial(name)}
    </span>
  );
}

/** The unseen-chat count — the one numeral-in-a-dot the row allows. */
export function ChatMark({ count }: { count: number }) {
  return (
    <>
      <MessageCircle aria-hidden className={GLYPH} />
      <span aria-hidden className={`${NUMERAL} -ml-px`}>{count > 9 ? '9+' : count}</span>
    </>
  );
}
