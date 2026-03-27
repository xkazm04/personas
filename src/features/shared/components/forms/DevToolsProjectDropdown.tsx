import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, FolderGit2, Check, Loader2 } from 'lucide-react';
import { listProjects } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import { Listbox } from './Listbox';

interface DevToolsProjectDropdownProps {
  /** Currently selected project ID (or null). */
  value: string | null;
  /** Callback when a project is selected. Returns the full DevProject. */
  onSelect: (project: DevProject) => void;
  /** Optional status filter (default: 'active'). */
  status?: string;
  /** Placeholder text when nothing is selected. */
  placeholder?: string;
  /** Additional classes on the root container. */
  className?: string;
}

/**
 * Reusable dropdown that queries DevTools projects from SQLite and presents
 * them in an app-themed selector. Shows project name, root path, and tech stack.
 *
 * Used by template adoption flows to let users pick which codebase to work with.
 */
export function DevToolsProjectDropdown({
  value,
  onSelect,
  status = 'active',
  placeholder = 'Select a project...',
  className,
}: DevToolsProjectDropdownProps) {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProjects(status).then((result) => {
      if (!cancelled) {
        setProjects(result);
        setLoading(false);
      }
    });
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
            <FolderGit2 className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground/50">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading projects...
              </span>
            ) : selected ? (
              <div className="min-w-0">
                <span className="font-medium">{selected.name}</span>
                {selected.root_path && (
                  <span className="text-muted-foreground/40 ml-2 text-xs truncate">
                    {selected.root_path}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground/40">{placeholder}</span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground/40 flex-shrink-0 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="absolute z-50 mt-1 w-full bg-background border border-primary/15 rounded-xl shadow-lg overflow-hidden">
          {projects.length === 0 && !loading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground/50">
              No projects found. Add a project in Dev Tools first.
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
                    <FolderGit2 className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">
                        {project.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {project.root_path && (
                          <span className="text-xs text-muted-foreground/40 truncate">
                            {project.root_path}
                          </span>
                        )}
                        {project.tech_stack && (
                          <span className="text-[10px] text-muted-foreground/35 bg-secondary/50 px-1.5 py-0.5 rounded">
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
