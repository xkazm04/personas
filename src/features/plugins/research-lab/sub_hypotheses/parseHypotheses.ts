/**
 * Parse an LLM-generated hypothesis list into discrete statements.
 * Tolerant to numbered lists, bulleted lists, JSON arrays, or newline-split plain text.
 */
export function parseHypothesesOutput(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && 'statement' in v ? String((v as { statement: unknown }).statement) : ''))
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through
    }
  }

  // Match numbered or bulleted lines
  const listItemRegex = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/gm;
  const matches: string[] = [];
  let m;
  while ((m = listItemRegex.exec(trimmed)) !== null) {
    const captured = m[1]?.trim();
    if (captured) matches.push(captured);
  }
  if (matches.length > 0) return dedupe(matches);

  // Fallback: split on blank lines, keep non-trivial lines
  return dedupe(
    trimmed
      .split(/\n{2,}|\r\n\r\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10 && !s.startsWith('#')),
  );
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase().slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
