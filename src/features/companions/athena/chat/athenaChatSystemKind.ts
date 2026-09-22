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
 *  - **operation records** — two shapes, and the LIVE one is not the one this
 *    module first targeted. `fleet-event session:… cc:… state:… project:…` is a
 *    per-state-transition row and there are **259** of them in the live DB;
 *    `fleet-orchestration op:… state:… intent:…` is the multi-session wrap-up
 *    and there are **0**, because it requires a completed Athena-dispatched
 *    operation that has never happened. Both are handled: the first line of
 *    either is pure correlator tokens and belongs in the meta line, not the
 *    body. (Measured 2026-08-07; the original regex matched only the 0-row
 *    shape, so all 259 real rows fell through to `plain` and rendered their
 *    correlator line as prose — exactly what this module promises to strip.)
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

/**
 * `fleet-event session:<id> cc:<id> state:<token> project:<name>` — the shape
 * that actually occurs (259 rows live). Every field is a correlator; there is
 * no prose on this line at all, so the whole line becomes meta and the body is
 * whatever follows it.
 */
const FLEET_EVENT_RE = /^fleet-event\s+(.+)$/;

/**
 * An opaque identifier — a uuid or a long hex run. Deliberately NOT "anything
 * long": `state:exited_failed` is 13 characters and is the single most useful
 * token on the line, so a naive length rule truncated the one field a reader
 * actually wants.
 */
const OPAQUE_ID_RE = /^[0-9a-f]{8}[0-9a-f-]{8,}$/i;

/** Pull `key:value` pairs out of a correlator line, shortening opaque ids. */
function correlators(line: string): string {
  const parts: string[] = [];
  for (const m of line.matchAll(/(\w+):(\S+)/g)) {
    const [, key, value] = m;
    if (!key || !value) continue;
    // A uuid identifies; it is not meant to be read. Eight chars is enough to
    // correlate against a log and short enough not to eat the line.
    parts.push(`${key} ${OPAQUE_ID_RE.test(value) ? `${value.slice(0, 8)}…` : value}`);
  }
  return parts.join(' · ');
}

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

  const fleetEvent = FLEET_EVENT_RE.exec(text.split('\n')[0] ?? '');
  if (fleetEvent) {
    const nl = text.indexOf('\n');
    return {
      kind: 'fleet_op',
      label: labels.fleetOp,
      body: nl === -1 ? '' : text.slice(nl).trim(),
      meta: correlators(fleetEvent[1] ?? ''),
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
