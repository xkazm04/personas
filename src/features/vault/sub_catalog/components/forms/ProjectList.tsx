import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
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
        <PressSurface key={project.id} onPress={() => onSelect(project.id)} selected={isSelected(project.id)} className="w-full flex items-start gap-3 p-3 rounded-modal border border-hair">
          <FolderOpen className={`w-5 h-5 mt-0.5 shrink-0 ${isSelected(project.id) ? 'text-role-agent' : 'text-foreground'}`} />
          <div className="min-w-0 flex-1">
            <p className="typo-body text-ink-1 truncate">{project.name}</p>
            <p className="typo-caption text-foreground truncate">{project.root_path}</p>
            {project.tech_stack && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {project.tech_stack.split(',').map((t) => (
                  <span key={t.trim()} className="typo-caption px-1.5 py-0.5 rounded-input bg-surface-2 text-foreground border border-hair">
                    {t.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
          {multiSelect && (
            <div className={`w-4 h-4 mt-1 rounded-interactive border flex-shrink-0 flex items-center justify-center ${
              isSelected(project.id) ? 'bg-role-agent border-role-agent' : 'border-hair'
            }`}>
              {isSelected(project.id) && <span className="text-foreground typo-label">&#10003;</span>}
            </div>
          )}
        </PressSurface>
      ))}
    </div>
  );
}
