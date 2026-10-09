// Which doc-rot backlog items are about which doc. The step detail's `related`
// carries an item's title and status, not the doc it was filed for; the
// doc-rot findings name the doc at the end of their title ("Refresh stale doc:
// <path>", "Doc names paths that no longer exist: <path>"), so an item is
// about a doc when its title names that doc's path as a whole token. An item
// naming no doc on the list is still shown, just not tied to a row.
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

/** Characters that may sit right before a path in a title. */
const BEFORE = new Set([' ', ':', '(', '"', "'", '`']);
/** Characters that may sit right after one (a sentence's full stop only when the title ends there). */
const AFTER = new Set([' ', ',', ';', ':', ')', '"', "'", '`']);

/** Whether `title` names `path` as a whole token, not as part of a longer path. */
export function titleNamesDoc(title: string, path: string): boolean {
  if (!path) return false;
  let at = title.indexOf(path);
  while (at >= 0) {
    const before = at === 0 || BEFORE.has(title[at - 1]!);
    const end = at + path.length;
    const next = title[end];
    const after = next === undefined || AFTER.has(next) || (next === '.' && (end + 1 === title.length || title[end + 1] === ' '));
    if (before && after) return true;
    at = title.indexOf(path, at + 1);
  }
  return false;
}

export function docRotItems(related: LifecycleRelatedItem[]): LifecycleRelatedItem[] {
  return related.filter((i) => i.source === 'doc_rot');
}

export interface BacklogMatch {
  /** The items about each doc, in `related` order (newest first, open before closed). */
  byDoc: Map<string, LifecycleRelatedItem[]>;
  /** Each item's doc, when its title names one on the list. */
  docOf: Map<string, string>;
}

/**
 * Ties each doc-rot item to the doc its title names. When a title names
 * several listed paths (one a prefix folder of another cannot happen: a doc
 * path is a file), the longest wins.
 */
export function matchBacklog(docPaths: string[], related: LifecycleRelatedItem[]): BacklogMatch {
  const byDoc = new Map<string, LifecycleRelatedItem[]>();
  const docOf = new Map<string, string>();
  const longestFirst = [...docPaths].sort((a, b) => b.length - a.length);
  for (const item of docRotItems(related)) {
    const doc = longestFirst.find((p) => titleNamesDoc(item.title, p));
    if (!doc) continue;
    docOf.set(item.id, doc);
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), item]);
  }
  return { byDoc, docOf };
}
