// Project lens for the topic graph — visually consistent with the footer's
// SwitcherBreadcrumb (colour square + name + chevron button, popover rows
// with a check on the active one), but scoped to ONE workspace's members and
// carrying a null row: the whole-workspace default view.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

export function ProjectFilter({
  projects,
  selectedId,
  onSelect,
}: {
  projects: DevProject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={w.graph_project_filter}
        className="flex items-center gap-1.5 h-7 px-2 rounded-interactive border border-border/60 bg-secondary/50 max-w-[220px] text-foreground hover:bg-secondary/80 transition-colors"
      >
        <FolderGit2 className="w-3.5 h-3.5 text-foreground/60 flex-shrink-0" aria-hidden />
        <span className={`typo-label truncate min-w-0 ${active ? '' : 'text-foreground/70'}`}>
          {active?.name ?? w.graph_all_projects}
        </span>
        <ChevronDown
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="animate-fade-slide-in absolute top-full right-0 mt-1.5 w-64 rounded-card border border-border/70 bg-background shadow-elevation-3 z-30 overflow-hidden">
          <div className="max-h-[280px] overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left transition-colors ${
                selectedId === null
                  ? 'bg-primary/10 text-foreground'
                  : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
              }`}
            >
              <span className="w-2 h-2 rounded-sm bg-muted-foreground/50 flex-shrink-0" aria-hidden />
              <span className="flex-1 truncate">{w.graph_all_projects}</span>
              {selectedId === null && <Check className="w-3 h-3 flex-shrink-0" />}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left transition-colors ${
                  selectedId === p.id
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
                }`}
              >
                <span className="w-2 h-2 rounded-sm bg-primary/60 flex-shrink-0" aria-hidden />
                <span className="flex-1 truncate">{p.name}</span>
                {selectedId === p.id && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
