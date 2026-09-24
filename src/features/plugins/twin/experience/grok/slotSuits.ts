/**
 * Suit marks for the four setup slots.
 *
 * Identity is carried by SHAPE — a distinct icon plus a distinct rank letter,
 * exactly the way a real deck tells hearts from spades. It is deliberately NOT
 * carried by colour: every suit is keyed off `--primary`, so the only colour
 * that varies on this table is status (`StatusGlyph`, `status-*`). Before
 * 2026-09-24 the suits wore `status-info` / `status-success` / `status-warning`
 * and the same rows also rendered real status, so green read as "done" when it
 * meant "channels".
 */

import { BookOpen, MessagesSquare, Radio, Sparkles, type LucideIcon } from 'lucide-react';
import type { SetupFocus } from '../../setup/setupContract';

export interface SlotSuit {
  id: SetupFocus;
  Icon: LucideIcon;
  /** Corner pip tint. Theme accent for every suit — never a status colour. */
  pip: string;
  border: string;
  borderPicked: string;
  wash: string;
  /** Playing-card rank letter drawn in the corners. The identity signal. */
  rank: string;
}

function suit(id: SetupFocus, Icon: LucideIcon, rank: string): SlotSuit {
  return {
    id,
    Icon,
    rank,
    pip: 'text-primary',
    border: 'border-primary/30',
    borderPicked: 'border-primary',
    wash: 'bg-primary/10',
  };
}

export const SLOT_SUITS: Record<SetupFocus, SlotSuit> = {
  identity: suit('identity', Sparkles, 'I'),
  tone: suit('tone', MessagesSquare, 'V'),
  channels: suit('channels', Radio, 'C'),
  memories: suit('memories', BookOpen, 'M'),
};
