/**
 * Pure reading of `manifest.md` — no IO, no React.
 *
 * The manifest is ONE document with two authors, told apart by the `# `
 * heading: the LAW sections (`Mandate`, `Boundaries`, `Operation defaults`)
 * are the operator's, written wholesale through `update_persona_manifest_law`;
 * the SELF-MODEL sections (`My work`, `My self-reads`) are the agent's, grown
 * only by anchored `self_model_diff` proposals a human approves.
 *
 * Which heading is which is NOT decided here — the server hands the split down
 * on `PersonaManifestView` (`lawSections` / `selfSections`), so a heading the
 * backend later adds classifies correctly without a frontend release.
 */

/** Who may write a section. `other` is a heading the server claimed neither. */
export type ManifestSectionKind = 'law' | 'self' | 'other';

export interface ManifestSection {
  /** The `# ` heading text, or `''` for the preamble before the first one. */
  heading: string;
  /** Everything under the heading, trimmed of leading/trailing blank lines. */
  body: string;
  kind: ManifestSectionKind;
}

/**
 * Hide the leading YAML frontmatter block (`---\n…\n---\n`) the file carries
 * for its `type:` / `updated:` bookkeeping.
 *
 * This is a DISPLAY decision and nothing else — deliberately not a mirror of
 * any server function, and it carries no obligation to agree with one. The
 * backend has its own frontmatter strippers, but they decide what reaches a
 * MODEL; this one decides what a reader sees, and the two can diverge without
 * anything breaking (the worst case here is a stray `---` rendered as a rule).
 * The `updated:` value a reader actually needs arrives typed, as
 * `PersonaManifestView.updatedAt`, rather than being re-parsed out of the text.
 */
export function stripFrontmatter(md: string): string {
  // The blank line the writer leaves after the closing fence goes too, so the
  // body starts at its first real character rather than at an empty line.
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n[\r\n]*/, '');
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function classify(
  heading: string,
  law: readonly string[],
  self: readonly string[],
): ManifestSectionKind {
  if (law.some((l) => eq(l, heading))) return 'law';
  if (self.some((s) => eq(s, heading))) return 'self';
  return 'other';
}

/**
 * Split the manifest into its `# ` sections, IN FILE ORDER — the order is the
 * document, so it is never sorted or grouped by author here.
 */
export function parseManifestSections(
  content: string,
  law: readonly string[],
  self: readonly string[],
): ManifestSection[] {
  const lines = stripFrontmatter(content).split(/\r?\n/);
  const out: ManifestSection[] = [];
  let heading = '';
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').replace(/^\s*\n+/, '').replace(/\s+$/, '');
    if (heading === '' && body === '') return;
    out.push({ heading, body, kind: heading === '' ? 'other' : classify(heading, law, self) });
  };

  for (const line of lines) {
    // `# X` only — `## X` keeps its second `#` where `\s` is required.
    const match = /^#\s+(.+)$/.exec(line.trimStart());
    if (match?.[1]) {
      flush();
      heading = match[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

/** One anchored diff, as the proposal's `summary` previews it. */
export interface ManifestDiffPreview {
  /** The full section path, e.g. `My work / What I own`. */
  section: string;
  /** Its `# ` heading — what decides where the preview renders. */
  heading: string;
  /** The rest of the preview line (`add: "…"`, `"…" -> "…"`, `remove: "…"`). */
  text: string;
}

/**
 * Parse a `self_model_diff` proposal's `summary` back into per-diff previews.
 *
 * The server builds it as one `IdentityDiff::preview()` per line, each shaped
 * `**<section path>** · <what changes>` — that is the only place the diff's
 * target section survives onto the wire (`MemoryReviewProposal` carries no
 * typed diff list), so parsing it is what lets a pending change render AT the
 * section it would edit. A line that does not match is kept whole under an
 * empty heading rather than dropped, so nothing pending is ever invisible.
 */
export function parseDiffPreviews(summary: string | null | undefined): ManifestDiffPreview[] {
  if (!summary) return [];
  return summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^\*\*(.+?)\*\*\s*[·:-]?\s*(.*)$/.exec(line);
      if (!match?.[1]) return { section: '', heading: '', text: line };
      const section = match[1].trim();
      return {
        section,
        heading: (section.split(' / ')[0] ?? section).trim(),
        text: (match[2] ?? '').trim(),
      };
    });
}
