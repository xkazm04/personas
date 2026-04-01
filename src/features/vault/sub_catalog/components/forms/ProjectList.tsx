import { FolderOpen } from 'lucide-react';

interface DevProject {
  id: string;
  name: string;
  root_path: string;
  description: string | null;
  status: string;
  tech_stack: string | null;
}

interface ProjectListProps {
  projects: DevProject[];
  isSelected: (id: string) => boolean;
  onSelect: (id: string) => void;
  multiSelect?: boolean;
}

export function ProjectList({ projects, isSelected, onSelect, multiSelect }: ProjectListProps) {
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project.id)}
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
              {isSelected(project.id) && <span className="text-white text-[10px] font-bold">&#10003;</span>}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
