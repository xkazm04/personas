import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { Translations } from '@/i18n/en';
import { humanizePayload } from './payloadView';

/* ----------------------------------------------------------------------------
 * DECISION TITLE — the two levels of a decision-log row.
 *
 * Every channel source used to put ONE string in `body` and the row and the
 * detail modal both rendered it, so a row was either a clipped wall of text
 * (a deliberation turn averages ~950 chars on the dev database, max 57k) or a
 * bare machine token with nothing under it (a bus event has no body at all).
 * Each source actually carries a short, readable headline — it just lives in
 * a different place per source:
 *
 *   step         → lifecycle verb (from `label`) + the step/assignment title.
 *                  The detail is the payload (error, task), already fields.
 *   event        → the payload's human line, else the humanized event type.
 *   memory       → the memory's own title (the read model joins it to the
 *                  content as `title — content`); the content is the detail.
 *   deliberation → the turn's first sentence; the whole turn is the detail.
 *
 * `detail` is null when the title already says everything — the modal then
 * shows the title alone (plus whatever structured fields the kind has).
 *
 * Pure: no React, no i18n. The verb is returned as a code; the UI resolves it.
 * -------------------------------------------------------------------------- */

/** The step-layer kinds that carry a lifecycle verb. */
export type StepVerb =
  | 'created'
  | 'step_running'
  | 'step_done'
  | 'step_failed'
  | 'step_skipped'
  | 'status_awaiting_review'
  | 'status_done'
  | 'qa_changes_requested_rework';

/** The i18n key of each verb (type-only import — this module stays pure). */
export const STEP_VERB_KEY: Record<StepVerb, keyof Translations['monitor']> = {
  created: 'stream_verb_created',
  step_running: 'stream_verb_step_running',
  step_done: 'stream_verb_step_done',
  step_failed: 'stream_verb_step_failed',
  step_skipped: 'stream_verb_step_skipped',
  status_awaiting_review: 'stream_verb_status_awaiting_review',
  status_done: 'stream_verb_status_done',
  qa_changes_requested_rework: 'stream_verb_qa_changes_requested_rework',
};

const STEP_VERBS = new Set<string>(Object.keys(STEP_VERB_KEY));

export interface DecisionTitle {
  /** Lifecycle verb code — step rows only. */
  verb: StepVerb | null;
  /** One short, readable line. Never empty. */
  title: string;
  /** The long form behind the title, markdown. Null when the title is the whole story. */
  detail: string | null;
}

/** A row title is read at a glance; past this it is a paragraph. */
export const TITLE_MAX = 120;

/** `signal.raised` / `qa_pr_approved` → `Signal raised` / `Qa pr approved`. */
export function humanizeToken(token: string): string {
  const spaced = token.replace(/[._\-:]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : token;
}

/** Strip the markdown and chat ornaments that read as noise in a one-liner. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    // A leading emoji ornament ("🛠 Ran …") carries no words.
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max = TITLE_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

/**
 * The headline of free text: its first sentence (or first line), de-markdowned
 * and clipped. A sentence ends at `.`/`!`/`?` followed by whitespace — so
 * `display.ts:29` and `v0.4.3` never split — or at a trailing `:` that
 * introduces a block ("Ran “Review”:").
 */
export function firstSentence(text: string, max = TITLE_MAX): string {
  const firstLine = text.split(/\n\s*\n|\n/).find((l) => plain(l).length > 0) ?? text;
  const line = plain(firstLine);
  const m = /^(.+?[.!?])(\s|$)/.exec(line);
  const sentence = (m?.[1] ?? line).replace(/:$/, '');
  return clip(sentence, max);
}

/** Does the detail add anything the title didn't already say? */
function extra(title: string, detail: string | null | undefined): string | null {
  if (!detail) return null;
  const d = detail.trim();
  if (!d) return null;
  const t = title.replace(/…$/, '');
  return plain(d) === t ? null : d;
}

export function decisionTitle(item: TeamChannelItem): DecisionTitle {
  const body = item.body?.trim() ?? '';

  if (item.kind === 'step') {
    const verb = STEP_VERBS.has(item.label) ? (item.label as StepVerb) : null;
    return {
      verb,
      title: clip(body || humanizeToken(item.label)),
      detail: body.length > TITLE_MAX ? body : null,
    };
  }

  if (item.kind === 'event') {
    const primary = humanizePayload(item.extra).primary;
    const type = humanizeToken(item.label);
    if (!primary) return { verb: null, title: type, detail: null };
    const title = firstSentence(primary);
    return { verb: null, title, detail: extra(title, primary) };
  }

  if (item.kind === 'memory') {
    // `title — content` (the read model's join). A title equal to its content
    // is sent bare, so a missing separator means the body IS the title.
    const sep = body.indexOf(' — ');
    const head = sep > 0 ? body.slice(0, sep) : body;
    const rest = sep > 0 ? body.slice(sep + 3) : null;
    const title = clip(plain(head) || humanizeToken(item.label));
    return { verb: null, title, detail: extra(title, rest ?? (head.length > TITLE_MAX ? head : null)) };
  }

  // Deliberation turns (and any other voiced row that reaches the log).
  if (!body) return { verb: null, title: humanizeToken(item.label), detail: null };
  const title = firstSentence(body);
  return { verb: null, title, detail: extra(title, body) };
}
