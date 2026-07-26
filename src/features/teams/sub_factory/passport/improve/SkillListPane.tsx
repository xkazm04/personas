// Shared left-panel skill list for the unified workbench. Deliberately
// title-ONLY rows (name, name-asc, single-select, filterable) — description /
// usage telemetry belong in the detail pane, not here; a bare name list is the
// fastest thing to scan for orientation. Fills its parent's fixed height and
// scrolls inside.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

import type { WorkbenchSkill } from './skillsWorkbenchData';

export function SkillListPane({ items, selected, onSelect, loading, emptyLabel }: {
  items: WorkbenchSkill[];
  selected: string | null;
  onSelect: (name: string) => void;
  loading?: boolean;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState('');
  // Filter, then group by canonical category (null → "Other"), categories
  // sorted name-asc; skills inside each group keep their name-asc order.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((s) => s.name.toLowerCase().includes(q)) : items;
    const byCat = new Map<string, WorkbenchSkill[]>();
    for (const s of filtered) {
      const cat = s.category ?? 'Other';
      const list = byCat.get(cat);
      if (list) list.push(s);
      else byCat.set(cat, [s]);
    }
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, query]);
  const empty = groups.length === 0;

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/35" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills…"
            className="w-full pl-8 pr-3 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
            data-testid="skills-workbench-filter"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="py-10"><LoadingSpinner label="Loading skills…" /></div>
        ) : items.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-10 px-2 text-center leading-snug">{emptyLabel}</p>
        ) : empty ? (
          <p className="typo-caption text-foreground/45 py-10 px-2 text-center">No skill matches “{query}”.</p>
        ) : (
          groups.map(([cat, skills]) => (
            <div key={cat} className="mb-1.5">
              <div className="px-2.5 pt-1.5 pb-1 typo-label text-foreground/40 uppercase tracking-[0.08em]" data-testid={`skills-workbench-cat-${cat}`}>
                {cat}
              </div>
              <ul className="space-y-0.5">
                {skills.map((s) => {
                  const on = s.name === selected;
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        onClick={() => onSelect(s.name)}
                        aria-pressed={on}
                        className={`w-full text-left px-2.5 py-2 rounded-interactive transition-colors border ${on ? 'bg-primary/12 border-primary/25' : 'border-transparent hover:bg-primary/[0.05]'}`}
                        data-testid={`skills-workbench-skill-${s.name}`}
                      >
                        <span className="typo-caption font-medium text-foreground truncate block">{s.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
