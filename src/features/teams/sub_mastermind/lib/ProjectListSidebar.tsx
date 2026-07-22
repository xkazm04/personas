// Left project sidebar — hidden by default, expands from an icon button.
// Lists every project (name asc) with a show/hide-in-canvas toggle, and the
// header creates a new project through the same ProjectModal mechanism the
// Projects manager uses.
import { Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';

import { STATE_INK } from './ink';
import type { Island } from './types';

const COPY = {
  title: 'Projects',
  open: 'Show project list',
  close: 'Hide project list',
  newProject: 'New project',
  show: 'Show in canvas',
  hide: 'Hide from canvas',
};

export function ProjectListSidebar({ islands, hidden, open, onOpenToggle, onToggleVisible, onNewProject }: {
  /** ALL islands (including canvas-hidden ones), any order. */
  islands: Island[];
  hidden: Set<string>;
  open: boolean;
  onOpenToggle: () => void;
  onToggleVisible: (slug: string) => void;
  onNewProject: () => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpenToggle}
        aria-label={COPY.open}
        title={COPY.open}
        className="absolute top-3 left-3 z-10 p-2 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm text-foreground/70 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
        data-testid="mm-projects-open"
      >
        <PanelLeftOpen className="w-4 h-4" aria-hidden />
      </button>
    );
  }

  const sorted = [...islands].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside
      className="absolute top-0 left-0 bottom-0 w-[248px] z-20 bg-secondary/95 backdrop-blur-sm border-r border-primary/12 shadow-elevation-3 flex flex-col"
      data-testid="mm-projects-sidebar"
    >
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-primary/10">
        <span className="typo-label text-foreground/50 uppercase tracking-wider">{COPY.title}</span>
        <span className="typo-caption text-foreground/40 tabular-nums">{sorted.length}</span>
        <button
          type="button"
          onClick={onNewProject}
          aria-label={COPY.newProject}
          title={COPY.newProject}
          className="ml-auto p-1 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-projects-new"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenToggle}
          aria-label={COPY.close}
          title={COPY.close}
          className="p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-projects-close"
        >
          <PanelLeftClose className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto py-1">
        {sorted.map((i) => {
          const isHidden = hidden.has(i.slug);
          return (
            <li key={i.slug}>
              <div className={`flex items-center gap-2 px-3 py-1.5 hover:bg-primary/[0.06] transition-colors ${isHidden ? 'opacity-50' : ''}`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATE_INK[i.state] }} aria-hidden />
                <span className="typo-caption text-foreground/90 truncate flex-1">{i.name}</span>
                <button
                  type="button"
                  onClick={() => onToggleVisible(i.slug)}
                  aria-label={isHidden ? COPY.show : COPY.hide}
                  aria-pressed={!isHidden}
                  title={isHidden ? COPY.show : COPY.hide}
                  className="p-1 rounded-interactive text-foreground/55 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
                  data-testid={`mm-project-visibility-${i.slug}`}
                >
                  {isHidden ? <EyeOff className="w-3.5 h-3.5" aria-hidden /> : <Eye className="w-3.5 h-3.5" aria-hidden />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
