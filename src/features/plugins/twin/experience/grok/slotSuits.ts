/**
 * Suit marks for the four setup slots. Colour AND shape so a colour-blind
 * reader can still tell identity from tone. Tokens only — no raw palette.
 */

import { BookOpen, MessagesSquare, Radio, Sparkles, type LucideIcon } from 'lucide-react';
import type { SetupFocus } from '../../setup/setupContract';

export interface SlotSuit {
  id: SetupFocus;
  Icon: LucideIcon;
  /** Corner pip. Distinct per slot, not a status colour. */
  pip: string;
  border: string;
  borderPicked: string;
  wash: string;
  /** Playing-card rank letter drawn in the corners. */
  rank: string;
}

export const SLOT_SUITS: Record<SetupFocus, SlotSuit> = {
  identity: {
    id: 'identity',
    Icon: Sparkles,
    pip: 'text-primary',
    border: 'border-primary/30',
    borderPicked: 'border-primary',
    wash: 'bg-primary/10',
    rank: 'I',
  },
  tone: {
    id: 'tone',
    Icon: MessagesSquare,
    pip: 'text-status-info',
    border: 'border-status-info/30',
    borderPicked: 'border-status-info',
    wash: 'bg-status-info/10',
    rank: 'V',
  },
  channels: {
    id: 'channels',
    Icon: Radio,
    pip: 'text-status-success',
    border: 'border-status-success/30',
    borderPicked: 'border-status-success',
    wash: 'bg-status-success/10',
    rank: 'C',
  },
  memories: {
    id: 'memories',
    Icon: BookOpen,
    pip: 'text-status-warning',
    border: 'border-status-warning/35',
    borderPicked: 'border-status-warning',
    wash: 'bg-status-warning/10',
    rank: 'M',
  },
};
