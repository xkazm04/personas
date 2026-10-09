// The Board's piles on the Activity board's lines (Classic's persona and
// session lines, the Lanes' session cards).
//
// THE COLOUR DECISION IS NOT MADE HERE. A persona's pile is the Board's own
// (`grid/skin/piles.ts` `pileKey`), and a session is folded into the same
// four piles through the fold the panel filter already speaks
// (`boardFilter.ts` `sessionBucket`), so a command-bar tag, a line's fill and
// the Board's tile cannot disagree about one thing:
//
//   needs   - awaiting input or stale (amber), exited with a failure (red)
//   working - running or spawning
//   resting - idle, queued, hibernated, finished: alive, nothing to do
//   off     - ended: a clean exit, or a queue row that expired unrun
//
// What this module adds is only the SKIN: the `fb-tile` pile classes
// with `--fb-tone` from `PILE_VISUAL`, and `ae-pile`, which takes the tile out
// of the Board's absolute layout and into a list (entryE.css).

import type { CSSProperties } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../monitorModel';
import { PILE_VISUAL, pileKey, type Pile, type PileKey } from '../../skin/piles';
import { sessionBucket } from './boardFilter';
import '../../skin/skin.css';

/** A session's pile with its needs tone resolved. */
export function sessionPileKey(s: Pick<FleetSession, 'state' | 'exitCode'>): PileKey {
  switch (sessionBucket(s)) {
    case 'running':
      return 'working';
    case 'attention':
      return 'warning';
    case 'failed':
      return 'critical';
    default:
      return s.state === 'exited' || s.state === 'expired' ? 'off' : 'resting';
  }
}

/**
 * A persona's pile on a Classic line: the Board's, except that a persona whose
 * project is switched off is drawn off. It cannot run there, so "resting" or
 * "working" would promise work it will not do; needing you still wins, as it
 * does on the Board.
 */
export function personaLinePileKey(card: PersonaCardModel, projectOff: boolean): PileKey {
  const key = pileKey(card);
  return projectOff && key !== 'critical' && key !== 'warning' ? 'off' : key;
}

export const pileOfKey = (key: PileKey): Pile => (key === 'critical' || key === 'warning' ? 'needs' : key);

/** A stable sweep phase per line, so a lane of working lines does not march in step. */
function sweepDelay(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `${-((Math.abs(h) % 32) / 10)}s`;
}

export interface PileSkin {
  pile: Pile;
  className: string;
  style: CSSProperties;
}

/** The tile classes and tone for one line. `seed` (an id) staggers the working sweep. */
export function pileSkin(key: PileKey, seed: string): PileSkin {
  const pile = pileOfKey(key);
  return {
    pile,
    className: `fb-tile ae-pile is-${pile}${key === 'critical' ? ' is-critical' : ''}`,
    style: { '--fb-tone': PILE_VISUAL[key].tone, '--fb-sd': sweepDelay(seed) } as CSSProperties,
  };
}
