import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, FolderGit2, Check, Loader2, Wrench } from 'lucide-react';
import { listProjects } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import { Listbox } from './Listbox';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';

const logger = createLogger('devtools-project-dropdown');

interface DevToolsProjectDropdownProps {
  /** Currently selected project ID (or null). */
  value: string | null;
  /** Callback when a project is selected. Returns the full DevProject. */
  onSelect: (project: DevProject) => void;
  /** Optional status filter (default: undefined = all projects). */
  status?: string;
  /** Placeholder text when nothing is selected. */
  placeholder?: string;
  /** Additional classes on the root container. */
  className?: string;
}

/**
 * Reusable dropdown that queries DevTools projects from SQLite and presents
 * them in an app-themed selector. Shows project name, root path, and tech stack.
 * Sorted by name ascending.
 *
 * Used by template adoption flows to let users pick which codebase to work with.
 */
export function DevToolsProjectDropdown({
  value,
  onSelect,
  status,
  placeholder: placeholderProp,
  className,
}: DevToolsProjectDropdownProps) {
  const { t } = useTranslation();
  const placeholder = placeholderProp ?? t.shared.devtools_select_project;
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await listProjects(status);
        if (cancelled) return;
        // Sort by name ascending
        const sorted = [...result].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        );
        setProjects(sorted);
      } catch (err) {
        if (cancelled) return;
        logger.error('Failed to load DevTools projects', { error: String(err) });
        setError(String(err));
        setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [status]);

  const selected = projects.find((p) => p.id === value);

  const handleSelect = useCallback(
    (index: number) => {
      const project = projects[index];
      if (project) onSelect(project);
    },
    [projects, onSelect],
  );

  return (
    <Listbox
      className={className}
      itemCount={projects.length}
      onSelectFocused={handleSelect}
      ariaLabel="Select DevTools project"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={`w-full flex items-center justify-between px-4 py-3 text-sm rounded-xl border border-primary/15 bg-background/80 text-foreground transition-all hover:border-primary/25 focus:outline-none ${
            isOpen ? 'border-primary/25' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderGit2 className="w-4 h-4 text-foreground flex-shrink-0" />
            {loading ? (
              <span className="flex items-center gap-2 text-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t.shared.devtools_loading_projects}
              </span>
            ) : error ? (
              <span className="text-rose-400/80 text-xs">{t.shared.devtools_load_failed}</span>
            ) : selected ? (
              <div className="min-w-0">
                <span className="font-medium">{selected.name}</span>
                {selected.root_path && (
                  <span className="text-foreground ml-2 text-xs truncate">
                    {selected.root_path}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-foreground">{placeholder}</span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-foreground flex-shrink-0 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="w-full bg-background border border-primary/15 rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="px-4 py-6 flex items-center justify-center gap-2 text-sm text-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.shared.devtools_loading}
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-rose-400/80 mb-1">{t.shared.devtools_load_failed}</p>
              <p className="text-xs text-foreground">{error}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Wrench className="w-5 h-5 text-primary/60" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">{t.shared.devtools_no_projects}</p>
              <p className="text-xs text-foreground mb-3">
                {t.shared.devtools_no_projects_hint}
              </p>
              <p className="text-xs text-foreground">
                {t.shared.devtools_no_projects_nav}
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              {projects.map((project, i) => {
                const isSelected = project.id === value;
                const isFocused = i === focusIndex;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      onSelect(project);
                      close();
                    }}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                      isFocused
                        ? 'bg-primary/10'
                        : isSelected
                          ? 'bg-primary/[0.06]'
                          : 'hover:bg-secondary/40'
                    }`}
                  >
                    <FolderGit2 className="w-4 h-4 text-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">
                        {project.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {project.root_path && (
                          <span className="text-xs text-foreground truncate">
                            {project.root_path}
                          </span>
                        )}
                        {project.tech_stack && (
                          <span className="text-[10px] text-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                            {project.tech_stack}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Listbox>
  );
}
