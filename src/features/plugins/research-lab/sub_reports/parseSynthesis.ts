import { silentCatch } from '@/lib/silentCatch';

export interface ReportSynthesis {
  abstract: string;
  discussion: string;
}

/**
 * Parse an LLM-generated report synthesis into a structured `{ abstract, discussion }`.
 *
 * Tolerant — mirrors `parseHypothesesOutput`:
 *  - strips ```json / ``` fences and surrounding prose
 *  - parses the first balanced JSON object it can find
 *  - falls back to extracting `## Abstract` / `## Discussion` markdown sections
 * Returns `null` when nothing usable could be recovered.
 */
export function parseSynthesisOutput(raw: string): ReportSynthesis | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  // 1) Try a JSON object embedded anywhere in the output (fenced or bare prose).
  const jsonText = extractJsonObject(trimmed);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const abstract = coerceString(parsed.abstract);
      const discussion = coerceString(parsed.discussion);
      if (abstract || discussion) {
        return { abstract: abstract.trim(), discussion: discussion.trim() };
      }
    } catch (err) {
      silentCatch('features/plugins/research-lab/sub_reports/parseSynthesis:json')(err);
    }
  }

  // 2) Fall back to markdown headings.
  const abstract = extractSection(trimmed, 'abstract');
  const discussion = extractSection(trimmed, 'discussion');
  if (abstract || discussion) {
    return { abstract: abstract.trim(), discussion: discussion.trim() };
  }

  return null;
}

function coerceString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  // Tolerate a persona returning an array of paragraph strings.
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean).join('\n\n');
  return String(v);
}

/** Find the first balanced `{ ... }` block, ignoring leading code fences / prose. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Pull the body under a `# Abstract` / `## Discussion` style heading. */
function extractSection(text: string, name: 'abstract' | 'discussion'): string {
  const re = new RegExp(`^#{1,6}\\s*${name}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|$(?![\\s\\S]))`, 'im');
  const m = re.exec(text);
  if (!m) return '';
  return (m[1] ?? '').trim();
}
