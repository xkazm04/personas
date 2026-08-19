/**
 * The frontmatter subset the knowledge corpus actually uses — one reader, shared
 * by every registry-lane script.
 *
 * This repo already treats "two parsers over one contract" as a live drift risk
 * (`hierarchy_read.rs` pins itself against `check-corpus-integrity.mjs` with a
 * committed fixture precisely because of it). A third hand-rolled parser inside
 * `evidence-check.mjs` would have been exactly that mistake again, so the pieces
 * `mirror-paths.mjs` already had live here now and both scripts import them.
 *
 * Deliberately NOT a YAML implementation. The corpus uses one shape:
 *
 *   key: scalar                  # optional trailing comment
 *   key:
 *     - item                     # optional trailing comment
 *     - item
 *   key: [inline, array]
 *
 * Anything richer is a corpus bug the integrity checker fails on, not something
 * to silently accommodate here.
 */

/**
 * Split a document into (frontmatter lines, body). Returns null when there is no
 * frontmatter block — the caller decides whether that is fatal for this file kind.
 */
export const splitDoc = (raw) => {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  return {
    fmLines: m[1].split(/\r?\n/),
    body: raw.slice(m[0].length),
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
  };
};

/** True for a line that opens a top-level frontmatter key. */
export const isTopLevelKey = (line) => /^[A-Za-z_][A-Za-z0-9_-]*:/.test(line);

/**
 * Strip a trailing ` # comment`. Only after whitespace: a `#` that opens a value
 * or sits mid-token is data (an anchor, a fragment), not a comment. This is the
 * single quirk most likely to drift between the readers — the Rust parser's
 * `hierarchy_strips_trailing_comments_only_after_whitespace` test pins the same
 * rule on the other side.
 */
export const stripComment = (value) => {
  const m = value.match(/\s+#/);
  return (m ? value.slice(0, m.index) : value).trim();
};

/**
 * Values of a frontmatter key as a list. Handles the block form, the inline
 * array form, and a lone scalar (returned as a one-element list). Returns `[]`
 * when the key is absent — callers that need to distinguish "absent" from
 * "empty" should use `hasKey`.
 */
export const listValues = (fmLines, key) => {
  const start = fmLines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return [];

  const head = stripComment(fmLines[start].slice(key.length + 1));
  if (head.startsWith('[')) {
    const inner = head.slice(1, head.lastIndexOf(']'));
    return inner
      .split(',')
      .map((s) => stripComment(s).replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  if (head !== '') return [head.replace(/^["']|["']$/g, '')];

  const out = [];
  for (let i = start + 1; i < fmLines.length; i += 1) {
    const line = fmLines[i];
    if (isTopLevelKey(line)) break;
    const m = line.match(/^\s+-\s+(.*)$/);
    if (m) {
      const v = stripComment(m[1]).replace(/^["']|["']$/g, '');
      if (v) out.push(v);
    }
  }
  return out;
};

/** Scalar value of a key, or null when absent/empty. */
export const scalarValue = (fmLines, key) => {
  const line = fmLines.find((l) => l.startsWith(`${key}:`));
  if (!line) return null;
  const v = stripComment(line.slice(key.length + 1)).replace(/^["']|["']$/g, '');
  return v === '' ? null : v;
};

/** True when the key is declared at all, whatever its value. */
export const hasKey = (fmLines, key) => fmLines.some((l) => l.startsWith(`${key}:`));
