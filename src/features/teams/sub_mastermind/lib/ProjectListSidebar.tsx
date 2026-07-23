// Left project sidebar — hidden by default, expands from an icon button with
// a linear fade+slide (round-14 motion pass). Styled to match the app's
// 2nd-level sidebar menus (surface, header band, row typography). Lists every
// project (name asc) with a show/hide-in-canvas toggle; the header creates a
// new project through the same ProjectModal mechanism the Projects manager uses.
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { STATE_INK } from './ink';
import type { Island } from './types';

const LINEAR = { duration: 0.2, ease: 'linear' as const };

export function ProjectListSidebar({ islands, hidden, open, onOpenToggle, onToggleVisible, onNewProject }: {
  /** ALL islands (including canvas-hidden ones), any order. */
  islands: Island[];
  hidden: Set<string>;
  open: boolean;
  onOpenToggle: () => void;
  onToggleVisible: (slug: string) => void;
  onNewProject: () => void;
}) {
  const { t } = useTranslation();
  const sorted = [...islands].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={LINEAR}
            onClick={onOpenToggle}
            aria-label={t.mastermind.projects_open}
            title={t.mastermind.projects_open}
            className="absolute top-3 left-3 z-10 p-2 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm text-foreground/70 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
            data-testid="mm-projects-open"
          >
            <PanelLeftOpen className="w-4 h-4" aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={LINEAR}
            className="absolute top-0 left-0 bottom-0 w-[248px] z-20 bg-secondary/95 backdrop-blur-sm border-r border-primary/15 shadow-elevation-4 flex flex-col"
            data-testid="mm-projects-sidebar"
          >
            {/* header band — matches the app sidebar's section header */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-primary/10 bg-primary/5">
              <span className="typo-label text-foreground/90">{t.mastermind.projects_title}</span>
              <span className="typo-caption text-foreground/50 tabular-nums">{sorted.length}</span>
              <button
                type="button"
                onClick={onNewProject}
                aria-label={t.mastermind.new_project}
                title={t.mastermind.new_project}
                className="ml-auto p-1 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
                data-testid="mm-projects-new"
              >
                <Plus className="w-4 h-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onOpenToggle}
                aria-label={t.mastermind.projects_close}
                title={t.mastermind.projects_close}
                className="p-1 rounded-interactive text-foreground/70 hover:text-foreground hover:bg-secondary/40 transition-colors focus-ring"
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
                    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg typo-body transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground ${isHidden ? 'opacity-50' : ''}`}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATE_INK[i.state] }} aria-hidden />
                      <span className="truncate flex-1">{i.name}</span>
                      <button
                        type="button"
                        onClick={() => onToggleVisible(i.slug)}
                        aria-label={isHidden ? t.mastermind.show_in_canvas : t.mastermind.hide_from_canvas}
                        aria-pressed={!isHidden}
                        title={isHidden ? t.mastermind.show_in_canvas : t.mastermind.hide_from_canvas}
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
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
