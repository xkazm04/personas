import type { Translations } from '@/i18n/en';
import type { Outcome } from './AskHead';
import type { Ask } from './needsYouModel';

/** An ask's words, every one from the catalog: its kind, its verdict verbs and the outcome pair they print. */
export function askCopy(m: Translations['monitor'], ask: Ask): { kind: string; accept: string; reject: string; outcomes: readonly [Outcome, Outcome] } {
  const review = ask.kind === 'review';
  const accept = review ? m.quick_approve : m.cv_answer;
  const reject = review ? m.quick_reject : m.delib_skip;
  return {
    kind: review ? m.dc_deck_kind_review : m.dc_deck_kind_question,
    accept,
    reject,
    outcomes: [
      { verb: accept.toLowerCase(), effect: review ? m.dc_deck_yes_review : m.dc_deck_yes_question },
      { verb: reject.toLowerCase(), effect: review ? m.dc_deck_no_review : m.dc_deck_no_question },
    ],
  };
}
