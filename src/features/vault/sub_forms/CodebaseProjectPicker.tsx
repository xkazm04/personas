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
}

export function CodebaseProjectPicker({ onSave, onCancel }: CodebaseProjectPickerProps) {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const handleSave = () => {
    const project = projects.find((p) => p.id === selectedId);
    if (!project) return;
    onSave({
      project_id: project.id,
      project_name: project.name,
      root_path: project.root_path,
      tech_stack: project.tech_stack ?? '',
    });
  };

  const goToDevTools = () => {
    useSystemStore.getState().setSidebarSection('personas');
    // Navigate to plugins > dev-tools
    setTimeout(() => {
      useSystemStore.getState().setSidebarSection('plugins' as never);
      (useSystemStore.getState() as Record<string, unknown>).setPluginTab?.('dev-tools');
    }, 100);
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

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground/60">
        Select a project to connect as a codebase source for your agents.
      </p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => setSelectedId(project.id)}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
              selectedId === project.id
                ? 'border-indigo-500/30 bg-indigo-500/8'
                : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/30'
            }`}
          >
            <FolderOpen className={`w-5 h-5 mt-0.5 shrink-0 ${selectedId === project.id ? 'text-indigo-400' : 'text-muted-foreground/40'}`} />
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
          </button>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!selectedId}
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Connect Project
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
