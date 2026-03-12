// -- Shared primitives (single source of truth) --
export {
  TAG_STYLES,
  formatRelative,
  getSectionSummary,
  diffStrings,
} from '@/features/agents/sub_lab_shared/labPrimitives';

// -- Filter / Sort / Grouping helpers (prompt-lab specific) --

export type TagFilter = 'all' | 'production' | 'experimental' | 'archived';
export type SortOrder = 'newest' | 'oldest';
export type DateGroup = 'Today' | 'This Week' | 'Earlier';

export function getDateGroup(dateStr: string): DateGroup {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return 'Today';
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  if (d >= startOfWeek) return 'This Week';
  return 'Earlier';
}

const DATE_GROUP_ORDER: Record<DateGroup, number> = { Today: 0, 'This Week': 1, Earlier: 2 };

export interface GroupedVersions {
  group: DateGroup;
  versions: import('@/lib/bindings/PersonaPromptVersion').PersonaPromptVersion[];
}

export function filterSortGroup(
  versions: import('@/lib/bindings/PersonaPromptVersion').PersonaPromptVersion[],
  filter: TagFilter,
  sort: SortOrder,
): GroupedVersions[] {
  let filtered = filter === 'all' ? versions : versions.filter((v) => v.tag === filter);
  filtered = [...filtered].sort((a, b) => {
    const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return sort === 'newest' ? diff : -diff;
  });
  const map = new Map<DateGroup, GroupedVersions>();
  for (const v of filtered) {
    const g = getDateGroup(v.created_at);
    if (!map.has(g)) map.set(g, { group: g, versions: [] });
    map.get(g)!.versions.push(v);
  }
  return [...map.values()].sort((a, b) => DATE_GROUP_ORDER[a.group] - DATE_GROUP_ORDER[b.group]);
}
