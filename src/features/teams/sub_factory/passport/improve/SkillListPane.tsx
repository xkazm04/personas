// Shared left-panel skill list for the unified workbench (both variants + both
// entry points render this). Name-asc, single-select, filterable; each row
// carries the skill's source badge + a terse usage line so the choice is
// informed, not name-only. Fills its parent's fixed height and scrolls inside.
import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { INK } from '../passportInk';
import type { WorkbenchSkill } from './skillsWorkbenchData';

function UsageLine({ usage }: { usage: WorkbenchSkill['usage'] }) {
  if (!usage) return null;
  return (
    <span className="inline-flex items-center gap-1 typo-label text-foreground/40 whitespace-nowrap">
      {usage.dormant && <span style={{ color: INK.amber }}>dormant ·</span>}
      <span className="tabular-nums">{usage.invokes30d}×/30d</span>
      {usage.lastInvokedAt && <><span>·</span><RelativeTime timestamp={usage.lastInvokedAt} className="tabular-nums" /></>}
    </span>
  );
}

export function SkillListPane({ items, selected, onSelect, loading, emptyLabel, header }: {
  items: WorkbenchSkill[];
  selected: string | null;
  onSelect: (name: string) => void;
  loading?: boolean;
  emptyLabel: string;
  /** Optional row above the filter (e.g. the Adopt/Share direction toggle). */
  header?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {header && <div className="px-3 pt-3 pb-2 flex-shrink-0">{header}</div>}
      <div className={`px-3 flex-shrink-0 ${header ? 'pb-2' : 'pt-3 pb-2'}`}>
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
        ) : filtered.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-10 px-2 text-center">No skill matches “{query}”.</p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((s) => {
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
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="typo-caption font-medium text-foreground truncate">{s.name}</span>
                      {s.sourceLabel && <span className="typo-label text-foreground/35 ml-auto flex-shrink-0">{s.sourceLabel}</span>}
                    </span>
                    {s.description && <span className="typo-caption text-foreground/55 block leading-snug line-clamp-1 mt-0.5" style={{ fontWeight: 400 }}>{s.description}</span>}
                    {s.usage && <span className="block mt-0.5"><UsageLine usage={s.usage} /></span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
