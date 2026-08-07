/**
 * System episodes — telling apart the four things `role: 'system'` means.
 *
 * The transcript used to render every system row as an assistant-shaped
 * bubble, which put Athena's avatar next to text she never wrote and gave a
 * machine note the same visual weight as an answer. These rows are actually
 * four different kinds of thing:
 *
 *  - **markers** — `[autonomous continuation]`, `[fleet]`, `[proactive: …]`.
 *    Provenance only; `Bubble` already renders these as dividers.
 *  - **canvas readbacks** — handled by `athenaChatCanvasSummary`.
 *  - **tagged notes** — `[dispatcher] …`, `[skill] …`: written FOR Athena, in
 *    the imperative, often several sentences of instruction to her. The user
 *    should be able to see what happened without reading a briefing.
 *  - **operation records** — `fleet-orchestration op:… state:… intent:…`
 *    followed by a prose summary. The first line is pure correlator tokens.
 *
 * This module only classifies and splits; presentation is
 * `AthenaChatSystemNote`.
 */

export type SystemNoteKind = 'dispatcher' | 'fleet_op' | 'tagged' | 'plain';

export interface SystemNote {
  kind: SystemNoteKind;
  /** Display label for the note's header. Already Title Case — never shouted. */
  label: string;
  /** The body to render as markdown, with correlator noise removed. */
  body: string;
  /** Machine correlators worth keeping but not worth reading (fleet op ids). */
  meta?: string;
}

/** `fleet-orchestration op:<id> state:<token> intent:<text>` + a blank line. */
const FLEET_OP_RE = /^fleet-orchestration\s+op:(\S+)\s+state:(\S+)\s+intent:(.*)$/;

/** A leading `[word]` provenance tag. */
const TAG_RE = /^\[([a-z][a-z0-9_ -]*)\]\s*/i;

/** `dispatcher` → `Dispatcher`, `human_review` → `Human review`. */
function titleCase(tag: string): string {
  const words = tag.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * Classify a system episode body.
 *
 * `labels` supplies the localized names for the kinds we recognise by name;
 * an unrecognised `[tag]` falls back to a Title-Cased version of the tag
 * itself, which is honest (we don't know what it is) and still readable.
 */
export function classifySystemNote(
  content: string,
  labels: { dispatcher: string; fleetOp: string; plain: string },
): SystemNote {
  const text = content.trim();

  const fleetOp = FLEET_OP_RE.exec(text.split('\n')[0] ?? '');
  if (fleetOp) {
    const [, opId, state, intent] = fleetOp;
    // Everything after the first blank line is the human-readable wrap-up.
    // Guard the newline: on a single-line record `indexOf` returns -1 and a
    // bare `slice(-1)` would hand back the final CHARACTER as the summary.
    const nl = text.indexOf('\n');
    const rest = nl === -1 ? '' : text.slice(nl).trim();
    return {
      kind: 'fleet_op',
      label: labels.fleetOp,
      // Prefer the summary; fall back to the intent so the row is never empty.
      body: rest || (intent ?? '').trim(),
      meta: [state, opId ? `op ${opId.slice(0, 8)}` : null].filter(Boolean).join(' · '),
    };
  }

  const tag = TAG_RE.exec(text);
  if (tag) {
    const raw = (tag[1] ?? '').toLowerCase();
    const body = text.slice(tag[0].length).trim();
    if (raw === 'dispatcher') {
      return { kind: 'dispatcher', label: labels.dispatcher, body };
    }
    return { kind: 'tagged', label: titleCase(raw), body };
  }

  return { kind: 'plain', label: labels.plain, body: text };
}
