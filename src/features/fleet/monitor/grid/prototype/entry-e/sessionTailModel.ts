// A session line's TAIL (WP11 C): the persona line's anatomy (`personaTailModel`)
// applied to a session, so a bay of personas and sessions is one list. Pure.
//
//   kind, edge   the Board's pile, through the panel filter's fold
//                (`sessionPileKey`): a filter tag, an edge and a lamp cannot disagree
//   lamp         `sessionLamp(state)`, except that a line whose edge is lit
//                (needs you: awaiting input or stale; critical: a failed exit)
//                lights its lamp too, in the edge's tone
//   lead         the state glyph, always (it is what stays in the narrowest column)
//   word         the state in words after the glyph, except while it runs: the
//                tone edge and the run glyph already say it
//   figure       the session's age, at the right edge, where a persona's run
//                elapsed sits
//
// PRIORITY when the column is narrow (`LineParts.LineHead`): the project (a
// board-wide list only) leaves whole first, then the state word, then the title
// truncates to its floor, then the glyph. The figure and lamp never move. The
// full sentence (`sessionSentence`) is always in the tooltip.

import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { PileKey } from '../../skin/piles';
import { sessionPileKey } from './pileSkin';
import { compactAge, sessionLamp, type Lamp, type Tone } from './tone';

export interface SessionTailInput {
  state: FleetSessionState;
  exitCode: number | null;
  /** Epoch ms the session was created. */
  startedAt: number;
  now: number;
}

export interface SessionTail {
  kind: PileKey;
  tone: Tone;
  lamp: Lamp;
  /** The state word is drawn after the glyph. */
  word: boolean;
  /** The right-edge figure: the session's age. */
  age: string;
}

export function sessionTail(i: SessionTailInput): SessionTail {
  const kind = sessionPileKey(i);
  const lamp: Lamp = kind === 'critical' ? { tone: 'err', lit: true }
    : kind === 'warning' ? { tone: 'warn', lit: true }
      : sessionLamp(i.state);
  return { kind, tone: lamp.tone, lamp, word: kind !== 'working', age: compactAge(Math.max(0, i.now - i.startedAt)) };
}

/** The `t.monitor` keys the sentence speaks with (all existing keys). */
export interface SessionStrings {
  node_symbol_origin: string;
  node_symbol_project: string;
  node_symbol_elapsed: string;
  remote_on_device: string;
}

type Tx = (template: string, vars: Record<string, string | number>) => string;

export interface SessionSentenceParts {
  label: string;
  stateLabel: string | null;
  originLabel?: string | null;
  device?: string | null;
  project?: string | null;
  age: string;
}

/**
 * The line's whole story as ONE sentence for its tooltip and accessible name:
 * title, state, who dispatched it (or which device runs it), project, age. A
 * part with nothing behind it is left out.
 */
export function sessionSentence(p: SessionSentenceParts, m: SessionStrings, tx: Tx): string {
  return [
    p.label,
    p.stateLabel,
    p.originLabel ? tx(m.node_symbol_origin, { origin: p.originLabel }) : null,
    p.device ? tx(m.remote_on_device, { device: p.device }) : null,
    p.project ? tx(m.node_symbol_project, { name: p.project }) : null,
    tx(m.node_symbol_elapsed, { time: p.age }),
  ].filter((s): s is string => !!s).join(' · ');
}
