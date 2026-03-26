import { useState, useEffect } from 'react';
import { Code2, FolderOpen, ArrowRight, Loader2 } from 'lucide-react';
import { listProjects } from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';

interface DevProject {
  id: string;
  name: string;
  root_path: string;
  description: string | null;
  status: string;
  tech_stack: string | null;
}

interface CodebaseProjectPickerProps {
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
  credentialName?: string;
  onCredentialNameChange?: (name: string) => void;
  /** When true, allow selecting multiple projects (used by Codebases connector). */
  multiSelect?: boolean;
}

export function CodebaseProjectPicker({ onSave, onCancel, credentialName, onCredentialNameChange, multiSelect }: CodebaseProjectPickerProps) {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const result = await listProjects('active');
        setProjects(result);
      } catch (err) {
        console.error('Failed to load projects:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = (id: string) => {
    if (multiSelect) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } else {
      setSelectedId(id);
      const project = projects.find((p) => p.id === id);
      if (project && onCredentialNameChange && !credentialName?.startsWith('Custom')) {
        onCredentialNameChange(`Codebase — ${project.name}`);
      }
    }
  };

  const handleSave = () => {
    if (multiSelect) {
      const selected = projects.filter((p) => selectedIds.has(p.id));
      if (selected.length === 0) return;
      onSave({
        project_ids: JSON.stringify(selected.map((p) => p.id)),
        project_names: JSON.stringify(selected.map((p) => p.name)),
        root_paths: JSON.stringify(selected.map((p) => p.root_path)),
        mode: 'multi',
      });
    } else {
      const project = projects.find((p) => p.id === selectedId);
      if (!project) return;
      onSave({
        project_id: project.id,
        project_name: project.name,
        root_path: project.root_path,
        tech_stack: project.tech_stack ?? '',
      });
    }
  };

  const goToDevTools = () => {
    useSystemStore.getState().setSidebarSection('plugins' as never);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-primary/50" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center">
          <Code2 className="w-7 h-7 text-indigo-400/60" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">No projects found</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs">
            Add a project in Dev Tools first to connect a codebase to your agents.
          </p>
        </div>
        <button
          type="button"
          onClick={goToDevTools}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/25 transition-colors"
        >
          Go to Dev Tools
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  const isSelected = (id: string) => multiSelect ? selectedIds.has(id) : selectedId === id;
  const hasSelection = multiSelect ? selectedIds.size > 0 : !!selectedId;

  return (
    <div className="space-y-4">
      {/* Credential name input */}
      {onCredentialNameChange && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            Credential Name
          </label>
          <input
            type="text"
            value={credentialName ?? ''}
            onChange={(e) => onCredentialNameChange(e.target.value)}
            placeholder={multiSelect ? 'My Codebases' : 'My Codebase'}
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground/60">
        {multiSelect
          ? 'Select projects to include in cross-project analysis.'
          : 'Select a project to connect as a codebase source for your agents.'}
      </p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => handleSelect(project.id)}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
              isSelected(project.id)
                ? 'border-indigo-500/30 bg-indigo-500/8'
                : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/30'
            }`}
          >
            <FolderOpen className={`w-5 h-5 mt-0.5 shrink-0 ${isSelected(project.id) ? 'text-indigo-400' : 'text-muted-foreground/40'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground/90 truncate">{project.name}</p>
              <p className="text-[11px] text-muted-foreground/50 truncate">{project.root_path}</p>
              {project.tech_stack && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {project.tech_stack.split(',').map((t) => (
                    <span key={t.trim()} className="text-[10px] px-1.5 py-0.5 rounded-md bg-secondary/50 text-muted-foreground/60 border border-primary/10">
                      {t.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {multiSelect && (
              <div className={`w-4 h-4 mt-1 rounded border flex-shrink-0 flex items-center justify-center ${
                isSelected(project.id) ? 'bg-indigo-500 border-indigo-500' : 'border-primary/20'
              }`}>
                {isSelected(project.id) && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasSelection}
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {multiSelect ? `Connect ${selectedIds.size} Project${selectedIds.size !== 1 ? 's' : ''}` : 'Connect Project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground/60 hover:text-foreground/70 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
