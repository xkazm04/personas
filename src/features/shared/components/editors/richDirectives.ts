/**
 * The TAG LAYER of RichMarkdown - a remark plugin, pure, no React.
 *
 * Markdown gets custom tags through the CommonMark directive proposal
 * (`remark-directive`): `:::name{attrs}` for a container, `::name{attrs}` for a
 * leaf, `:name[label]{attrs}` inline. This plugin decides which of those are
 * part of the vocabulary and rewrites each into an element the renderer maps
 * onto a component. There is ONE vocabulary in this app for agent-authored UI,
 * and it is SurfaceSpec (`surface/SPEC.md`): every block tag here IS a
 * SurfaceSpec block, validated by the same zod schema, so a table written in a
 * markdown document and a table in a surface are the same thing. The only tags
 * that are not SurfaceSpec blocks are the content grammar (`content/`) the
 * execution detail is built from - a card, a well, an eyebrow, a pill.
 *
 * Two honesty rules:
 *  * An inline tag the vocabulary does not know is RESTORED to its literal
 *    source. Prose like "status:ok" or "see:[x]" parses as a text directive;
 *    swallowing it would silently rewrite what an agent wrote.
 *  * A block tag that is unknown, or whose body fails its schema, is kept and
 *    shown as written with the reason - never dropped (the SurfaceSpec salvage
 *    rule: a dropped block is surfaced, not hidden).
 */

/** The tags, by the directive form they are written in. */
export const RICH_CONTAINER_TAGS = ['card', 'well', 'stats', 'table', 'decisions', 'terminal'] as const;
export const RICH_LEAF_TAGS = ['card', 'eyebrow', 'gauge', 'progress'] as const;
export const RICH_TEXT_TAGS = ['pill'] as const;

/** Tags whose body is DATA (a fenced JSON block or raw lines), not prose. */
const DATA_BODY_TAGS = new Set(['stats', 'table', 'decisions', 'terminal']);

/** Element names the renderer maps. Prefixed so they can never collide with
 *  a real HTML element or a built-in markdown renderer. */
export const RICH_ELEMENT_PREFIX = 'rich-';
export const RICH_UNKNOWN = 'rich-unknown';

// Minimal structural types for the mdast nodes this plugin touches - the
// directive shapes come from `mdast-util-directive`, which remark-directive
// brings in; naming them locally keeps undeclared type packages out of the
// import graph.
interface Position {
  start: { offset?: number };
  end: { offset?: number };
}
interface MdNode {
  type: string;
  name?: string;
  value?: string;
  lang?: string | null;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  position?: Position;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    directiveLabel?: boolean;
  };
}
interface VFileLike {
  value?: unknown;
}

const isDirective = (n: MdNode) =>
  n.type === 'containerDirective' || n.type === 'leafDirective' || n.type === 'textDirective';

function textOf(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

function sourceOf(node: MdNode, file: VFileLike): string {
  const src = typeof file.value === 'string' ? file.value : String(file.value ?? '');
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start != null && end != null ? src.slice(start, end) : `:${node.name ?? ''}`;
}

function knownFor(node: MdNode): boolean {
  const name = node.name ?? '';
  if (node.type === 'containerDirective') return (RICH_CONTAINER_TAGS as readonly string[]).includes(name);
  if (node.type === 'leafDirective') return (RICH_LEAF_TAGS as readonly string[]).includes(name);
  return (RICH_TEXT_TAGS as readonly string[]).includes(name);
}

/** Attributes, cleaned: a missing value is an empty string, never `null`. */
function attrsOf(node: MdNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attributes ?? {})) out[k] = v ?? '';
  return out;
}

function toElement(node: MdNode, hName: string, props: Record<string, unknown>): void {
  node.data = { ...(node.data ?? {}), hName, hProperties: props };
}

/**
 * Rewrite one directive in place. Returns the replacement node when the
 * directive must be REPLACED (an unknown inline tag restored to text), or
 * null when it was rewritten where it stands.
 */
function rewrite(node: MdNode, file: VFileLike): MdNode | null {
  const name = node.name ?? '';

  if (!knownFor(node)) {
    if (node.type === 'textDirective') return { type: 'text', value: sourceOf(node, file) };
    toElement(node, RICH_UNKNOWN, { 'data-name': name, 'data-source': sourceOf(node, file) });
    node.children = [];
    return null;
  }

  const attrs = attrsOf(node);
  const children = node.children ?? [];

  // A container's `[label]` arrives as its first paragraph, flagged. It is
  // the card's title, not part of its body.
  const labelIdx = children.findIndex((c) => c.data?.directiveLabel);
  if (labelIdx >= 0) {
    attrs.title ??= textOf(children[labelIdx]!).trim();
    children.splice(labelIdx, 1);
  }
  if (node.type === 'leafDirective' && children.length > 0 && !attrs.title) {
    attrs.title = textOf(node).trim();
  }

  if (DATA_BODY_TAGS.has(name)) {
    // The body is data: the first fenced code block, verbatim. Anything else
    // in the body is ignored rather than guessed at.
    const code = children.find((c) => c.type === 'code');
    toElement(node, `${RICH_ELEMENT_PREFIX}${name}`, {
      'data-attrs': JSON.stringify(attrs),
      'data-body': code?.value ?? '',
      'data-source': sourceOf(node, file),
    });
    node.children = [];
    return null;
  }

  toElement(node, `${RICH_ELEMENT_PREFIX}${name}`, { 'data-attrs': JSON.stringify(attrs) });
  if (node.type === 'leafDirective' && name !== 'card') node.children = [];
  return null;
}

function walk(node: MdNode, file: VFileLike): void {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    if (isDirective(child)) {
      const replacement = rewrite(child, file);
      if (replacement) {
        kids[i] = replacement;
        continue;
      }
    }
    walk(child, file);
  }
}

/** The remark plugin. Runs after `remark-directive` has parsed the tags. */
export function remarkRichDirectives() {
  return (tree: MdNode, file: VFileLike) => {
    walk(tree, file);
  };
}

/** Read the attributes a rewritten element carries. */
export function readAttrs(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
