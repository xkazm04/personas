/**
 * Suit marks for the four setup slots.
 *
 * Identity is carried by SHAPE — a distinct icon plus a distinct rank letter,
 * the way a real deck tells hearts from spades. It is deliberately NOT carried
 * by colour: every suit is keyed off `--primary`, so the only colour that
 * varies on this surface is status (`StatusGlyph`, `status-*`). The suits wore
 * `status-info` / `status-success` / `status-warning` in an earlier draft and
 * the same rows also rendered real status, so green read as "done" when it
 * meant "channels".
 *
 * The labels are not here. They resolve at render time from
 * `twin.experience.slots.<id>`, so the surface stays translatable and the suit
 * vocabulary has one home.
 */

import { BookOpen, MessagesSquare, Radio, Sparkles, type LucideIcon } from 'lucide-react';
import type { SetupFocus } from '../setup/setupContract';

export interface Suit {
  id: SetupFocus;
  Icon: LucideIcon;
  /** Corner pip tint. The theme accent for every suit — never a status colour. */
  pip: string;
  border: string;
  borderPicked: string;
  wash: string;
  /** Playing-card rank letter drawn in the corners. The identity signal. */
  rank: string;
}

function suit(id: SetupFocus, Icon: LucideIcon, rank: string): Suit {
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

export const SUITS: Record<SetupFocus, Suit> = {
  identity: suit('identity', Sparkles, 'I'),
  tone: suit('tone', MessagesSquare, 'V'),
  channels: suit('channels', Radio, 'C'),
  memories: suit('memories', BookOpen, 'M'),
};
