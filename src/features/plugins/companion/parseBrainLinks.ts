import type { BrainKind } from '@/api/companion';

/**
 * Scans BrainViewer detail-view markdown content for tokens that look
 * like memory ids — e.g. `goal_abc123`, `procedural_xyz`,
 * `design_decision_def456`. Returns one entry per UNIQUE id discovered,
 * preserving first-occurrence order so the chip strip below the content
 * reads in the same order the content does.
 *
 * Kinds matched (all link-targets BrainViewer can already open):
 *   episode, doctrine, fact, reflection, procedural, goal, ritual,
 *   backlog, design_decision.
 *
 * Tokens like `op_abc12` / `sess_aabbccdd` (orchestration) and other
 * arbitrary `<word>_<word>` tokens are NOT matched — the chip strip
 * is scoped to surfaces BrainViewer can navigate to.
 *
 * The full matched token (kind prefix + id segment) is passed to
 * `companion_get_brain_item` as the `id` arg. If a row's stored id
 * doesn't include the prefix the lookup will 404 — the DetailView's
 * existing error path surfaces "not found" without crashing, and the
 * chip strip degrades gracefully (still a one-shot click).
 */

export interface ParsedBrainLink {
  kind: BrainKind;
  id: string;
  raw: string;
}

// Keep this list in lockstep with `BrainKind` in `src/api/companion.ts`
// (excluding `identity` + `constitution` which are singletons with no
// per-row id, and any compound `kind:scope` variants which never appear
// as raw tokens in content). Ordering by length-desc ensures the regex
// alternation matches `design_decision_x` before falling through to a
// shorter prefix.
const KIND_TOKENS: BrainKind[] = [
  'design_decision',
  'reflection',
  'procedural',
  'doctrine',
  'backlog',
  'episode',
  'ritual',
  'fact',
  'goal',
];

const TOKEN_REGEX = new RegExp(
  `\\b(${KIND_TOKENS.join('|')})_([A-Za-z0-9-]+)\\b`,
  'g',
);

export function parseBrainLinks(content: string): ParsedBrainLink[] {
  const seen = new Set<string>();
  const out: ParsedBrainLink[] = [];
  for (const match of content.matchAll(TOKEN_REGEX)) {
    const kindToken = match[1] as BrainKind | undefined;
    const idTail = match[2];
    const raw = match[0];
    if (!kindToken || !idTail || seen.has(raw)) continue;
    seen.add(raw);
    out.push({ kind: kindToken, id: raw, raw });
  }
  return out;
}
