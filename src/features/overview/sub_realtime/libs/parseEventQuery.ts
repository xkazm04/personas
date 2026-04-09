/**
 * Mini structured-query parser for the EventLogSidebar.
 *
 * Supports:
 *   field:value   — exact substring match on a known field
 *   /regex/       — regex match against the full payload
 *   bare words    — full-text substring search across all fields
 *
 * Known fields: status, type, source, target, payload, error
 *
 * Example query:
 *   status:failed source:webhook /timeout/i deploy
 *   → filters to status containing "failed", source containing "webhook",
 *     payload matching /timeout/i regex, and any field containing "deploy"
 */

export interface ParsedQuery {
  /** field:value filters keyed by field name */
  fields: { field: string; value: string }[];
  /** /regex/ patterns to match against payload */
  regexPatterns: RegExp[];
  /** Unqualified full-text terms */
  freeText: string[];
}

const KNOWN_FIELDS = new Set(['status', 'type', 'source', 'target', 'payload', 'error']);

/**
 * Tokenise a raw query string into structured filters.
 * Malformed regex patterns fall back to literal text search.
 */
export function parseEventQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = { fields: [], regexPatterns: [], freeText: [] };
  if (!raw.trim()) return result;

  // Match: field:value | /regex/flags | bare-words (including quoted strings)
  const tokenRe = /(\w+):("(?:[^"\\]|\\.)*"|\S+)|\/(.+?)\/([gimsuy]*)|"([^"]*)"|\S+/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(raw)) !== null) {
    const token = m[0];

    // field:value
    if (m[1] && m[2] !== undefined) {
      const field = m[1].toLowerCase();
      let value = m[2];
      // Strip surrounding quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      if (KNOWN_FIELDS.has(field)) {
        result.fields.push({ field, value: value.toLowerCase() });
      } else {
        // Unknown field — treat as free text
        result.freeText.push(token.toLowerCase());
      }
      continue;
    }

    // /regex/flags
    if (m[3] !== undefined) {
      try {
        result.regexPatterns.push(new RegExp(m[3], m[4] || 'i'));
      } catch {
        // Bad regex — fall back to literal text
        result.freeText.push(m[3].toLowerCase());
      }
      continue;
    }

    // Quoted string without field prefix
    if (m[5] !== undefined) {
      result.freeText.push(m[5].toLowerCase());
      continue;
    }

    // Bare word
    result.freeText.push(token.toLowerCase());
  }

  return result;
}

interface MatchableEntry {
  eventType: string;
  source: string;
  target: string;
  status: string;
  payload: string | null;
  error: string | null;
}

const FIELD_ACCESSORS: Record<string, (e: MatchableEntry) => string> = {
  status: (e) => e.status,
  type: (e) => e.eventType,
  source: (e) => e.source,
  target: (e) => e.target,
  payload: (e) => e.payload ?? '',
  error: (e) => e.error ?? '',
};

/**
 * Test whether a log entry matches every clause in a parsed query.
 * All clauses are ANDed together.
 */
export function matchesQuery(entry: MatchableEntry, query: ParsedQuery): boolean {
  // field:value — each must match
  for (const { field, value } of query.fields) {
    const accessor = FIELD_ACCESSORS[field];
    if (!accessor) return false;
    if (!accessor(entry).toLowerCase().includes(value)) return false;
  }

  // /regex/ — each must match payload (or full entry text)
  const fullText = [
    entry.eventType, entry.source, entry.target, entry.status,
    entry.payload ?? '', entry.error ?? '',
  ].join(' ');

  for (const re of query.regexPatterns) {
    if (!re.test(fullText)) return false;
  }

  // Free text — each term must appear somewhere
  const fullLower = fullText.toLowerCase();
  for (const term of query.freeText) {
    if (!fullLower.includes(term)) return false;
  }

  return true;
}
