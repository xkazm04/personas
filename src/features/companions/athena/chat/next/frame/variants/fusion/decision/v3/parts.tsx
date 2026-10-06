/**
 * Fusion · decision v3 - the palette's small parts: the key cap (the notepad
 * desk's `Keycap` / the command palette's kbd), the queue switch carried by
 * the input row, and the fold key.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import type { ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as N } from '../../../../../nextCopy';
import type { QueueNav } from '../../DecisionStage';
import { FUSION_COPY as F } from '../../copy';
import { PALETTE_COPY as P } from './copy';

/** A physical key's legend: never copy, never a native tooltip. */
export function Keycap({ children, size = 'sm' }: { children: ReactNode; size?: 'sm' | 'lg' }) {
  return (
    <kbd className={`fd3-key${size === 'lg' ? ' is-lg typo-data' : ' typo-label'}`} aria-hidden>
      {children}
    </kbd>
  );
}

/** A passive legend in the palette's footer: the key, then what it does. */
export function Legend({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="fd3-legend typo-caption">
      {keys.map((k) => (
        <Keycap key={k}>{k}</Keycap>
      ))}
      {label}
    </span>
  );
}

function neighbour(nav: QueueNav, dir: 1 | -1) {
  const at = nav.items.findIndex((i) => i.id === nav.activeId);
  return nav.items[(at + dir + nav.items.length) % nav.items.length]!;
}

/** "3 of 8" between its two arrow keys, each a door to that neighbour. */
export function QueueSwitch({ nav }: { nav: QueueNav }) {
  const n = nav.items.length;
  const at = nav.items.findIndex((i) => i.id === nav.activeId);
  if (n < 2) return null;
  const door = (dir: 1 | -1) => {
    const it = neighbour(nav, dir);
    return (
      <Tooltip content={`${dir < 0 ? P.prev : P.next} · ${N.kind[it.kind]} · ${it.project ?? F.athena}`}>
        <Button
          variant="ghost"
          size="xs"
          className="fd3-keybtn"
          aria-label={dir < 0 ? P.prev : P.next}
          aria-keyshortcuts={dir < 0 ? 'ArrowLeft' : 'ArrowRight'}
          onClick={() => nav.onPick(it.id)}
        >
          <Keycap>{dir < 0 ? P.keys.left : P.keys.right}</Keycap>
        </Button>
      </Tooltip>
    );
  };
  return (
    <nav className="fd3-queue" aria-label={F.queue} data-testid="companion-fusion-d3-queue">
      {door(-1)}
      <span className="typo-caption tabular-nums">{F.itemOf(at + 1, n)}</span>
      {door(1)}
    </nav>
  );
}

export function FoldKey({ nav }: { nav: QueueNav }) {
  return (
    <Tooltip content={F.keys.fold}>
      <Button
        variant="ghost"
        size="xs"
        className="fd3-keybtn"
        onClick={nav.onFold}
        aria-label={F.keys.fold}
        aria-keyshortcuts="Escape"
        data-testid="companion-fusion-d3-fold-stage"
      >
        <Keycap>{P.keys.esc}</Keycap>
      </Button>
    </Tooltip>
  );
}

export function AsideKey({ nav }: { nav: QueueNav }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="fd3-keybtn typo-caption"
      onClick={nav.onAside}
      aria-keyshortcuts="Space"
      data-testid="companion-fusion-d3-aside"
    >
      <Keycap>{P.keys.space}</Keycap>
      {F.keys.aside}
    </Button>
  );
}
