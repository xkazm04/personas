/**
 * facetedTableModel.ts — pure helpers behind {@link ./FacetedDecisionTable}.
 *
 * A "faceted decision table" is a left rail of slash-path groups plus a filtered
 * table. The group hierarchy is DERIVED from the data at render time (arbitrary
 * depth, counts bubbled to the root, nothing hardcoded), so a corpus whose
 * taxonomy grows on its own — harvested practices, scanner findings — keeps
 * rendering without a code change.
 *
 * Generic over the row type: every domain hook is an injected accessor
 * (`getGroupPath`, `haystack`), so nothing here knows about knowledge items,
 * ideas, or any other feature shape.
 *
 * React-free on purpose — the rendering side lives in FacetedDecisionTable.
 */

/** A node in the derived group hierarchy. */
export interface GroupNode {
  /** Full slash path ('' = root). */
  path: string;
  /** Last path segment ('' for the root). */
  segment: string;
  /** Items exactly at this node. */
  own: number;
  /** Items at this node or any descendant. */
  total: number;
  children: GroupNode[];
}

/**
 * Build the group tree that actually exists in the data — arbitrary depth, no
 * hardcoded levels. Children sorted by descending total, then name.
 */
export function buildGroupTree<T>(
  items: readonly T[],
  getGroupPath: (row: T) => string,
): GroupNode {
  const root: GroupNode = { path: '', segment: '', own: 0, total: 0, children: [] };
  const byPath = new Map<string, GroupNode>([['', root]]);

  const ensure = (path: string): GroupNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const idx = path.lastIndexOf('/');
    const parent = ensure(idx === -1 ? '' : path.slice(0, idx));
    const node: GroupNode = {
      path,
      segment: idx === -1 ? path : path.slice(idx + 1),
      own: 0,
      total: 0,
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const item of items) {
    const node = ensure(getGroupPath(item) || '');
    node.own += 1;
    // bubble totals to the root
    for (let p = node.path; ; ) {
      const n = byPath.get(p)!;
      n.total += 1;
      if (p === '') break;
      const idx = p.lastIndexOf('/');
      p = idx === -1 ? '' : p.slice(0, idx);
    }
  }

  const sortRec = (node: GroupNode) => {
    node.children.sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment));
    node.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** All items under a group path (the node and its descendants). '' = everything. */
export function itemsUnderGroup<T>(
  items: readonly T[],
  getGroupPath: (row: T) => string,
  path: string,
): T[] {
  if (!path) return [...items];
  return items.filter((i) => {
    const p = getGroupPath(i);
    return p === path || p.startsWith(`${path}/`);
  });
}

/**
 * Case-insensitive substring search across the caller-supplied haystack fields.
 * An empty/whitespace query returns a COPY of the input (callers rely on the
 * result being a fresh array they can sort in place).
 */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  haystack: (row: T) => string[],
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((i) => haystack(i).some((f) => f.toLowerCase().includes(q)));
}
