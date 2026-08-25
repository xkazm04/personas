// Full-height skill selector for the Launch surface — a stable, scrollable
// sidebar (the old dropdown's width, w-72) so the whole registry lane is
// visible and switchable without opening anything. The circuit board renders
// to its right.
import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { SkillEntry } from '@/api/devTools/devTools';

export default function SkillListSidebar({ skills, selected, onSelect }: {
  skills: SkillEntry[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <aside
      className="w-72 flex-shrink-0 flex flex-col min-h-0 rounded-card border border-primary/10 bg-secondary/10"
      aria-label={d.launch_select_skill}
      data-testid="skill-launch-sidebar"
    >
      <div className="p-2 border-b border-primary/10">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          aria-label={t.common.search}
          className="w-full px-3 py-1.5 typo-caption rounded-input bg-background/50 text-foreground border border-primary/15 focus-ring focus-visible:border-primary/30 placeholder:text-foreground/50"
        />
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto py-1" role="listbox" aria-label={d.launch_select_skill}>
        {visible.map((s) => {
          const active = s.name === selected;
          return (
            <li key={s.name}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(active ? null : s.name)}
                className={`w-full flex items-baseline gap-2 px-3 py-2 text-left transition-colors border-l-2 min-w-0 ${
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent hover:bg-secondary/30'
                }`}
              >
                <span className={`typo-body truncate ${active ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {s.name}
                </span>
                <span
                  // muted-ok: structural micro-label (version chip beside the name)
                  className="typo-label text-foreground/45 ml-auto flex-shrink-0"
                >
                  v{s.version ?? '1.0'}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-4 typo-caption text-foreground/85">{t.common.no_results}</li>
        )}
      </ul>
    </aside>
  );
}
