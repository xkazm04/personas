/**
 * The four suits of the Twin table: one per setup slot, each with its glyph
 * and the CSS class that dresses it (`experience.css`).
 *
 * That class carries the suit's WEAVE — the angle and pitch of the pattern on
 * a card back — and its `--xo-hue`, which is `--primary` for all four. Colour
 * on this table means status and nothing else, so what tells the suits apart
 * is shape: the glyph here and the weave there.
 *
 * The labels are not here. They resolve at render time from
 * `twin.experience_opus.suits.<id>`, so the table stays translatable and the
 * suit vocabulary has one home.
 */

import { BookUser, MessagesSquare, Radio, Sparkles, type LucideIcon } from 'lucide-react';
import type { SetupFocus } from '../../setup/setupContract';

export interface Suit {
  id: SetupFocus;
  Icon: LucideIcon;
  /** Sets `--xo-hue` and the `--xo-weave*` pattern for everything inside it. */
  hue: string;
}

export const SUITS: Record<SetupFocus, Suit> = {
  identity: { id: 'identity', Icon: BookUser, hue: 'xo-suit-identity' },
  tone: { id: 'tone', Icon: MessagesSquare, hue: 'xo-suit-tone' },
  channels: { id: 'channels', Icon: Radio, hue: 'xo-suit-channels' },
  memories: { id: 'memories', Icon: Sparkles, hue: 'xo-suit-memories' },
};

/** Text in the suit's hue (the theme accent). Glyphs and short labels only. */
export const SUIT_TEXT = 'text-[var(--xo-hue)]';

/**
 * A tone channel as a person reads it. `generic` is the register used
 * everywhere without a channel of its own, so it shows as the caller's
 * translated "everywhere"; any other id is a channel type ("slack", "email")
 * shown with a capital, the way its product writes it.
 */
export function channelName(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}
