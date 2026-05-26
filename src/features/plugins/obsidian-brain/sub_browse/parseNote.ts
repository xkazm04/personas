export interface NoteProperty {
  key: string;
  value: string;
}

export interface ParsedNote {
  properties: NoteProperty[];
  body: string;
  wordCount: number;
}

/**
 * Split a vault note into its YAML frontmatter properties and its body, and
 * count the words in the body. Only flat `key: value` frontmatter lines are
 * parsed (the common Obsidian case); anything more structured is left as-is.
 * Deliberately dependency-free and forgiving — this is for display only, not
 * a spec-compliant YAML parse.
 */
export function parseNote(content: string): ParsedNote {
  let body = content;
  const properties: NoteProperty[] = [];

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    body = content.slice((fmMatch[0] ?? '').length);
    const yaml = fmMatch[1] ?? '';
    for (const line of yaml.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_.\- ]+):\s?(.*)$/);
      if (!m) continue;
      const key = (m[1] ?? '').trim();
      if (!key) continue;
      // Display cleanup: strip wrapping quotes and flatten a simple inline
      // list "[a, b]" down to "a, b".
      const value = (m[2] ?? '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^\[(.*)\]$/, '$1')
        .trim();
      properties.push({ key, value });
    }
  }

  const trimmed = body.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  return { properties, body, wordCount };
}
