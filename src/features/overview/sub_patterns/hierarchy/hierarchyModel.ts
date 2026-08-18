// Pure model helpers for the Subjects (knowledge hierarchy) view — grouping,
// rollups, search, and relative-link resolution. No I/O, no React: everything
// here is a function of the `HierarchyGraph` the Rust reader returned, which
// keeps the view thin and the behavior unit-testable.
import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import type { HierarchySubject } from '@/lib/bindings/HierarchySubject';

// -- category grouping ---------------------------------------------------------

export interface CategoryGroup {
  /** Category id, or `null` for subjects `categories.json` never assigned
   *  (a checker failure, but the view must still render them honestly). */
  id: string | null;
  title: string;
  order: number;
  subjects: HierarchySubject[];
  /** Rollups over the group's subjects. */
  subjectCount: number;
  statusCounts: Record<string, number>;
}

/**
 * Group subjects by category honoring `categories[].order` (order IS the
 * compass sequence — checker-enforced unique). Unassigned subjects collect in
 * a trailing pseudo-group with `id: null` so a category gap is visible rather
 * than silently dropped. Subjects sort by title within each group.
 */
export function groupSubjectsByCategory(graph: HierarchyGraph): CategoryGroup[] {
  const byCategory = new Map<string | null, HierarchySubject[]>();
  for (const s of graph.subjects) {
    const key = s.category;
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(s);
    else byCategory.set(key, [s]);
  }

  const groups: CategoryGroup[] = [];
  const orderedCategories = [...graph.categories].sort((a, b) => a.order - b.order);
  for (const cat of orderedCategories) {
    const subjects = byCategory.get(cat.id) ?? [];
    if (subjects.length === 0) continue; // an empty ring segment teaches nothing in a list
    groups.push(makeGroup(cat.id, cat.title, cat.order, subjects));
  }
  const unassigned = byCategory.get(null);
  if (unassigned && unassigned.length > 0) {
    groups.push(makeGroup(null, '', Number.MAX_SAFE_INTEGER, unassigned));
  }
  return groups;
}

function makeGroup(
  id: string | null,
  title: string,
  order: number,
  subjects: HierarchySubject[],
): CategoryGroup {
  const sorted = [...subjects].sort((a, b) => a.title.localeCompare(b.title));
  const statusCounts: Record<string, number> = {};
  for (const s of sorted) {
    const st = s.status ?? 'unknown';
    statusCounts[st] = (statusCounts[st] ?? 0) + 1;
  }
  return { id, title, order, subjects: sorted, subjectCount: sorted.length, statusCounts };
}

// -- search --------------------------------------------------------------------

/** One search hit. Every kind carries the SUBJECT slug so the rail can always
 *  surface the parent row, plus enough ids to open the exact thing matched. */
export type HierarchyMatch =
  | { kind: 'subject'; key: string; label: string; subject: string; score: number }
  | { kind: 'technique'; key: string; label: string; subject: string; technique: string; score: number }
  | { kind: 'application'; key: string; label: string; subject: string; file: string; score: number };

interface IndexEntry {
  match: HierarchyMatch;
  /** Lowercased primary haystack (title + slug). */
  primary: string;
  /** Lowercased secondary haystack (summary) — discounted so a body hit never
   *  outranks a title hit. */
  secondary: string;
}

export type HierarchyIndex = readonly IndexEntry[];

/** Grain weights — the subject is the cheapest jump to undo, so it wins ties
 *  (same rationale as the fabric omnibox's area-first weighting). */
const KIND_WEIGHT: Record<HierarchyMatch['kind'], number> = {
  subject: 3,
  technique: 2.4,
  application: 2,
};

/** Build the omnibox index from a graph. Pure — no I/O, no state. */
export function buildHierarchyIndex(graph: HierarchyGraph): HierarchyIndex {
  const out: IndexEntry[] = [];
  const push = (match: HierarchyMatch, primary: string, secondary = '') =>
    out.push({ match, primary: primary.toLowerCase(), secondary: secondary.toLowerCase() });

  for (const s of graph.subjects) {
    push(
      { kind: 'subject', key: `s:${s.slug}`, label: s.title, subject: s.slug, score: 0 },
      `${s.title} ${s.slug}`,
      s.summary,
    );
    for (const app of s.applications) {
      const name = app.file.split('/').pop() ?? app.file;
      push(
        {
          kind: 'application',
          key: `a:${app.file}`,
          label: name,
          subject: s.slug,
          file: app.file,
          score: 0,
        },
        `${name} ${app.stack} ${app.technique}`,
      );
    }
  }
  for (const tech of graph.techniques) {
    push(
      {
        kind: 'technique',
        key: `t:${tech.subject}/${tech.slug}`,
        label: tech.title,
        subject: tech.subject,
        technique: tech.slug,
        score: 0,
      },
      `${tech.title} ${tech.slug}`,
      tech.summary,
    );
  }
  return out;
}

/** Positional score of `q` inside `hay`: prefix beats word-start beats infix. */
function hitScore(hay: string, q: string): number {
  const i = hay.indexOf(q);
  if (i < 0) return 0;
  if (i === 0) return 3;
  return /[\s/\-_.]/.test(hay[i - 1] ?? '') ? 2 : 1;
}

export const HIERARCHY_SEARCH_MIN = 2;

/** Rank the index against a query — best first, at most `limit`. Below
 *  `HIERARCHY_SEARCH_MIN` characters it returns nothing (a one-letter query
 *  matches half the corpus and teaches the user nothing). */
export function searchHierarchy(
  index: HierarchyIndex,
  query: string,
  limit = 60,
): HierarchyMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length < HIERARCHY_SEARCH_MIN) return [];
  const scored: HierarchyMatch[] = [];
  for (const entry of index) {
    const primary = hitScore(entry.primary, q);
    const score = primary > 0 ? primary : hitScore(entry.secondary, q) * 0.25;
    if (score <= 0) continue;
    scored.push({ ...entry.match, score: score * KIND_WEIGHT[entry.match.kind] });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
  );
  return scored.slice(0, limit);
}

/** Collapse matches to the rail's grain: subject slug → whether the subject
 *  itself matched, plus the best child label for the "matched in …" hint. */
export interface SubjectMatchInfo {
  direct: boolean;
  /** Best-scored child match label (technique/application title), if any. */
  childHint: string | null;
}

export function subjectMatchMap(matches: readonly HierarchyMatch[]): Map<string, SubjectMatchInfo> {
  const map = new Map<string, SubjectMatchInfo>();
  for (const m of matches) {
    const existing = map.get(m.subject) ?? { direct: false, childHint: null };
    if (m.kind === 'subject') existing.direct = true;
    else if (existing.childHint === null) existing.childHint = m.label; // matches arrive best-first
    map.set(m.subject, existing);
  }
  return map;
}

// -- relative-link resolution ----------------------------------------------------

/** Where a relative markdown href from inside a hierarchy doc leads. */
export type DocLinkTarget =
  | { kind: 'subject'; subject: string }
  | { kind: 'technique'; subject: string; technique: string; file: string }
  | { kind: 'application'; subject: string; file: string }
  | { kind: 'law'; law: string; file: string }
  | { kind: 'doc'; file: string; anchor: string | null };

/** True for hrefs the interception should leave to the renderer's default
 *  external-link handling. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** Normalize a joined posix-ish path, resolving `.` and `..` segments. Returns
 *  null when `..` escapes the root — an href pointing outside the repo is
 *  unresolvable by definition. */
function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

/**
 * Resolve a relative markdown href found inside `currentFile` (a repo-relative
 * path like `docs/concepts/paths/table/table.md`) to a navigation target.
 * Returns `null` when the href is external, anchors-only, or points at nothing
 * the graph knows — callers surface that honestly (a toast), never a silent
 * no-op dressed as navigation.
 */
export function resolveDocLink(
  currentFile: string,
  href: string,
  graph: HierarchyGraph,
): DocLinkTarget | null {
  if (!href || isExternalHref(href) || href.startsWith('#')) return null;

  const hashIdx = href.indexOf('#');
  const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const rawAnchor = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
  const anchor = rawAnchor.length > 0 ? rawAnchor : null;
  const baseDir = currentFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const joined = rawPath.startsWith('/') ? rawPath.slice(1) : `${baseDir}/${rawPath}`;
  const resolved = normalizePath(joined);
  if (!resolved) return null;

  // docs/concepts/paths/_laws.md#anchor → a law reference.
  if (/(^|\/)_laws\.md$/.test(resolved)) {
    if (anchor && graph.laws.some((l) => l.id === anchor)) {
      return { kind: 'law', law: anchor, file: resolved };
    }
    return anchor ? null : { kind: 'doc', file: resolved, anchor: null };
  }

  const pathsMatch = /^docs\/concepts\/paths\/([^/]+)(?:\/(.*))?$/.exec(resolved);
  if (pathsMatch) {
    const subjectSlug = pathsMatch[1] as string;
    const rest = pathsMatch[2];
    const subject = graph.subjects.find((s) => s.slug === subjectSlug);
    if (!subject) return null;
    // The subject folder itself, or its golden path file.
    if (!rest || rest === '' || rest === `${subjectSlug}.md`) {
      return { kind: 'subject', subject: subjectSlug };
    }
    const techMatch = /^techniques\/([^/]+)\.md$/.exec(rest);
    if (techMatch) {
      const techSlug = techMatch[1] as string;
      const tech = graph.techniques.find(
        (t) => t.subject === subjectSlug && t.slug === techSlug,
      );
      if (tech) {
        return { kind: 'technique', subject: subjectSlug, technique: tech.slug, file: tech.file };
      }
      return null;
    }
    if (/^applications\//.test(rest)) {
      const app = subject.applications.find((a) => a.file === resolved);
      if (app) return { kind: 'application', subject: subjectSlug, file: app.file };
      return null;
    }
    // Some other file inside the subject folder — readable as a plain doc.
    return { kind: 'doc', file: resolved, anchor };
  }

  // Anything else under docs/concepts/ the reader can serve verbatim
  // (golden-path-deferred-fixes.md, legacy golden-paths/*, sibling notes).
  if (resolved.startsWith('docs/concepts/') && resolved.endsWith('.md')) {
    return { kind: 'doc', file: resolved, anchor };
  }
  return null;
}
