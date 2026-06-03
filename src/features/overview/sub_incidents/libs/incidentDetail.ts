/**
 * Normalizes an incident's `detail` payload so the inbox never renders a raw
 * JSON / `key=value` blob at a non-technical user.
 *
 * The backend promoter (`audit_incidents_promoter.rs`) fills `detail` with one
 * of several shapes depending on the source stream:
 *   - free-text prose  → "Rule 'Latency' fired: value 1200 latency threshold 800"
 *   - key=value pairs  → "tool_id=abc123, type=http"
 *   - a JSON object    → '{"status":403,"url":"https://…"}'
 *   - a raw tool error → multi-line message text
 *
 * This module collapses all of them to one predictable shape: either
 * human-readable `prose` (safe to show inline) or a list of labelled `facts`
 * (broken down in the detail modal, never dumped on a row). When the payload
 * was valid JSON the pretty-printed form is preserved as `rawJson` so the modal
 * can offer a "show raw" affordance for power users without it leaking into the
 * default reading path.
 */

export interface IncidentFact {
  /** Humanized label, e.g. "Tool Id". */
  label: string;
  /** Stringified value, compacted for nested structures. */
  value: string;
}

export type NormalizedDetailKind = 'empty' | 'prose' | 'facts';

export interface NormalizedDetail {
  kind: NormalizedDetailKind;
  /** Present when `kind === 'prose'`. */
  prose: string | null;
  /** Non-empty when `kind === 'facts'` and the payload had extractable keys. */
  facts: IncidentFact[];
  /** Pretty-printed JSON when the payload parsed as a JSON object/array. */
  rawJson: string | null;
}

const EMPTY: NormalizedDetail = { kind: 'empty', prose: null, facts: [], rawJson: null };

const ACRONYMS: Record<string, string> = {
  id: 'ID', url: 'URL', uri: 'URI', api: 'API', http: 'HTTP', https: 'HTTPS',
  ip: 'IP', ttl: 'TTL', sql: 'SQL', json: 'JSON', ai: 'AI', cpu: 'CPU', ms: 'ms',
};

/** snake / kebab / dot case → Title Case, preserving known acronyms. */
export function humanizeKey(key: string): string {
  return key
    .split(/[_.\s-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function factsFromObject(obj: Record<string, unknown>): IncidentFact[] {
  return Object.entries(obj)
    .map(([k, v]) => ({ label: humanizeKey(k), value: stringifyValue(v) }))
    .filter((f) => f.value.trim().length > 0);
}

// "tool_id=abc, type=http" — every comma-part must be a clean key=value token,
// otherwise we treat the whole string as prose (a sentence with an `=` in it).
const KV_PART = /^\s*[\w.-]+\s*=\s*.+$/;

function tryParseKeyValue(text: string): IncidentFact[] | null {
  if (!text.includes('=')) return null;
  const parts = text.split(',');
  const facts: IncidentFact[] = [];
  for (const part of parts) {
    if (!KV_PART.test(part)) return null; // not a clean kv list — bail to prose
    const eq = part.indexOf('=');
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) facts.push({ label: humanizeKey(key), value });
  }
  return facts.length > 0 ? facts : null;
}

/** Parse a JSON-shaped payload, or `null` if it isn't valid JSON. */
function tryJsonDetail(trimmed: string): NormalizedDetail | null {
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const rawJson = JSON.stringify(parsed, null, 2);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const facts = factsFromObject(parsed as Record<string, unknown>);
      return { kind: 'facts', prose: null, facts, rawJson };
    }
    // array or scalar JSON — keep the raw view, no flat facts
    return { kind: 'facts', prose: null, facts: [], rawJson };
  } catch {
    return null; // expected for prose that merely starts with a brace
  }
}

/**
 * Collapse a raw `detail` payload into prose-or-facts. Never throws; an
 * unparseable payload degrades to prose so nothing is ever lost.
 */
export function normalizeIncidentDetail(detail: string | null | undefined): NormalizedDetail {
  const trimmed = detail?.trim();
  if (!trimmed) return EMPTY;

  // 1. JSON object / array
  const json = tryJsonDetail(trimmed);
  if (json) return json;

  // 2. key=value list
  const kv = tryParseKeyValue(trimmed);
  if (kv) return { kind: 'facts', prose: null, facts: kv, rawJson: null };

  // 3. prose
  return { kind: 'prose', prose: trimmed, facts: [], rawJson: null };
}

/**
 * Convenience for list rows: the single human line to show inline, or `null`
 * when the payload is structured (in which case it belongs in the modal, not
 * on the row).
 */
export function incidentRowSubtext(detail: string | null | undefined): string | null {
  const n = normalizeIncidentDetail(detail);
  return n.kind === 'prose' ? n.prose : null;
}
