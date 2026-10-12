// DeckChips — the tone→token bridge the Decision Deck reads.
//
// `TriageItem` names semantic tones ('success', 'danger', …) and never a
// palette class; this module is the single place that turns one into the
// other, so the deck's card header and its fact lines cannot drift into two
// slightly different reds. The Quick Answer deck that used to share it (with
// its chips, keycaps and kind copy) was retired 2026-10-06 when the Decision
// Center replaced it; what is left is what the Decision Deck still imports.
import type { TriageTone } from '../triageTypes';

/** Text-only, for use over a surface that owns its own background. */
export const TONE_TEXT: Record<TriageTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-error',
};

/**
 * Band a 0..max score onto a tone.
 *
 * `invert` is the whole point: effort and risk are scales where LOW is the
 * good news, so a raw ratio would paint "effort 2/10" the same alarming red as
 * "impact 2/10". Flipping first means one banding rule colours every fact
 * honestly without the view learning which fact is which.
 */
export function bandTone(value: number, max: number, invert?: boolean): TriageTone {
  const span = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / span));
  const good = invert ? 1 - ratio : ratio;
  if (good >= 0.66) return 'success';
  if (good >= 0.33) return 'warning';
  return 'danger';
}
