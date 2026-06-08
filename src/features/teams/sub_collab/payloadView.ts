/* ----------------------------------------------------------------------------
 * payloadView — ONE robust, consistent reader for channel item payloads.
 *
 * Personas emit `emit_event` data as arbitrary JSON, so payload shapes vary
 * wildly across teams: some put the human line under `summary`, others under
 * `message` / `verdict` / `outcome`, some nest it under `data`, some are plain
 * text, some are pure machine metadata with no human line at all. The old
 * extractor checked a narrow key list in two different places (the row vs the
 * modal), so the same payload could render a summary in one and nothing in the
 * other. This module is the single source of truth both surfaces call.
 * -------------------------------------------------------------------------- */

/** Ordered keys that tend to hold the human-readable line. */
const PRIMARY_KEYS = [
  'summary', 'message', 'text', 'headline', 'title', 'description', 'details',
  'reason', 'verdict', 'outcome', 'result', 'note', 'content', 'status_message',
  'comment', 'body', 'task', 'goal',
];
/** Keys that hold a link we can turn into an artifact chip. */
const URL_KEYS = ['pr_url', 'prUrl', 'html_url', 'url', 'link', 'run_url'];
/** Keys that are machine noise — never shown as fields. */
const NOISE_KEYS = new Set([
  'step_id', 'stepId', 'id', 'assignment_id', 'assignmentId', 'persona_id', 'personaId',
  'timestamp', 'ts', 'created_at', 'updated_at', 'iv', 'payload_iv', 'event_id',
  ...URL_KEYS,
]);

export interface Artifact {
  url: string;
  label: string;
}

export interface PayloadView {
  /** The best human-readable line (null when the payload has none). */
  primary: string | null;
  /** Remaining scalar entries, humanized — for the modal's detail list. */
  fields: Array<[string, string]>;
  artifact: Artifact | null;
}

/** A long whitespace-free base64/hex blob — ciphertext or an id, never a message. */
function looksOpaque(s: string): boolean {
  const t = s.trim();
  return t.length >= 40 && !/\s/.test(t) && /^[A-Za-z0-9+/=_\-.]+$/.test(t);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function urlArtifact(o: Record<string, unknown>): Artifact | null {
  const url = pickString(o, URL_KEYS);
  if (!url) return null;
  const label = url.includes('/pull/') ? `PR ${url.split('/pull/')[1] ?? ''}`.replace(/\/$/, '').trim() : shortUrl(url);
  return { url, label: label || shortUrl(url) };
}

/** Title-case a snake/camel key for display (`status_message` → `Status message`). */
export function humanizeKey(k: string): string {
  const spaced = k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Decompose any channel payload into a primary line + scalar fields + artifact.
 * Handles JSON objects (incl. one level of nesting under data/payload/result),
 * JSON strings/arrays, and plain text — and never surfaces an opaque token.
 */
export function humanizePayload(raw: string | null | undefined): PayloadView {
  if (!raw) return { primary: null, fields: [], artifact: null };

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    // Not JSON — plain text is the line, unless it's an opaque token.
    return { primary: looksOpaque(raw) ? null : raw.trim(), fields: [], artifact: null };
  }

  if (typeof obj === 'string') return { primary: obj.trim() || null, fields: [], artifact: null };
  if (typeof obj === 'number' || typeof obj === 'boolean') return { primary: String(obj), fields: [], artifact: null };
  if (Array.isArray(obj)) {
    const strs = obj.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return { primary: strs.length ? strs.join(' · ') : null, fields: [], artifact: null };
  }
  if (!obj || typeof obj !== 'object') return { primary: null, fields: [], artifact: null };

  const o = obj as Record<string, unknown>;
  let primary = pickString(o, PRIMARY_KEYS);
  // One level of nesting — many agents wrap the real data under data/payload/result.
  if (!primary) {
    for (const nk of ['data', 'payload', 'result', 'detail']) {
      const nv = o[nk];
      if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
        primary = pickString(nv as Record<string, unknown>, PRIMARY_KEYS);
        if (primary) break;
      }
    }
  }

  const artifact = urlArtifact(o);
  const fields: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(o)) {
    if (NOISE_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t && t !== primary && !looksOpaque(t)) fields.push([humanizeKey(k), t]);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      fields.push([humanizeKey(k), String(v)]);
    }
    // objects/arrays are left to the raw view
  }
  return { primary, fields, artifact };
}

/** One-line summary for a compact row: the primary line, or a compact join of
 *  the first couple of fields, capped for display. */
export function payloadSummary(raw: string | null | undefined): { summary: string | null; artifact: Artifact | null } {
  const v = humanizePayload(raw);
  let summary = v.primary;
  if (!summary && v.fields.length) {
    summary = v.fields.slice(0, 2).map(([k, val]) => `${k}: ${val}`).join(' · ');
  }
  return { summary: summary ? summary.slice(0, 280) : null, artifact: v.artifact };
}
