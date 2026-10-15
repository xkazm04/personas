/**
 * laneMeta — each lane's glyph, name, one-line hint and printed key.
 *
 * Keys: `1`-`4` open Breach, Sign, Accept, Talk; `O` opens Orphans. Checked
 * against the Monitor's own map (2026-10-14): the board's attention cursor
 * takes plain `n` / `j` / `k` / `Enter` (`useAttentionCursor`), the Monitor
 * `Escape`, the app shell only modified keys (Ctrl+B, Ctrl+M, Alt+A,
 * Ctrl+Shift+M); an open peek takes arrows, `j`/`k`, `a`/`r`/`d`/`s`, Space,
 * Enter and Escape; the deck owns the keyboard while open. Plain digits, `o`,
 * `m` and `l` are free on the Activity surface.
 */
import type { LucideIcon } from 'lucide-react';
import { CheckCheck, CircleDashed, MessagesSquare, PenLine, ShieldAlert } from 'lucide-react';

import type { Translations } from '@/i18n/generated/types';

import type { LaneKey } from './laneModel';

export const LANE_ICON: Record<LaneKey, LucideIcon> = {
  breach: ShieldAlert,
  sign: PenLine,
  accept: CheckCheck,
  talk: MessagesSquare,
  orphan: CircleDashed,
};

/** The key printed on each lane button. */
export const LANE_KEY: Record<LaneKey, string> = {
  breach: '1',
  sign: '2',
  accept: '3',
  talk: '4',
  orphan: 'O',
};

/** The lane a plain key opens, or null. */
export function laneForKey(key: string): LaneKey | null {
  switch (key) {
    case '1': return 'breach';
    case '2': return 'sign';
    case '3': return 'accept';
    case '4': return 'talk';
    case 'o':
    case 'O': return 'orphan';
    default: return null;
  }
}

export function laneLabel(m: Translations['monitor'], lane: LaneKey): string {
  switch (lane) {
    case 'breach': return m.ml_lane_breach;
    case 'sign': return m.ml_lane_sign;
    case 'accept': return m.ml_lane_accept;
    case 'talk': return m.ml_lane_talk;
    case 'orphan': return m.ml_lane_orphan;
  }
}

export function laneHint(m: Translations['monitor'], lane: LaneKey): string {
  switch (lane) {
    case 'breach': return m.ml_lane_hint_breach;
    case 'sign': return m.ml_lane_hint_sign;
    case 'accept': return m.ml_lane_hint_accept;
    case 'talk': return m.ml_lane_hint_talk;
    case 'orphan': return m.ml_lane_hint_orphan;
  }
}

/** The lane `step` places away, wrapping (the peek's ←/→ walk). */
export function walkLane<T extends string>(lane: T, step: 1 | -1, order: readonly T[]): T {
  const i = order.indexOf(lane);
  return order[(i + step + order.length) % order.length]!;
}
