/**
 * ProjectStep — stage 1 editor of the project pipeline.
 *
 * Captures the project's local identity: folder path + display name (+ an
 * optional tech-stack tag). Extracted from the old flat ProjectModal "Project"
 * section so the stepper orchestrator can render it under the rail's node.
 */
import { FolderOpen, Pencil } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { type ProjectType, PROJECT_TYPES } from '../projectManagerTypes';

interface ProjectStepProps {
  isEdit: boolean;
  path: string;
  name: string;
  nameEdited: boolean;
  projectType: ProjectType;
  onSelectFolder: () => void;
  onNameChange: (value: string) => void;
  onTypeChange: (type: ProjectType) => void;
}

export function ProjectStep({
  isEdit, path, name, nameEdited, projectType,
  onSelectFolder, onNameChange, onTypeChange,
}: ProjectStepProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;

  return (
    <div className="space-y-5">
      {/* Folder picker (read-only in edit mode) */}
      <div>
        <label className="typo-caption font-medium text-foreground mb-1.5 block">{dp.project_folder}</label>
        <div className="flex gap-2">
          <div
            onClick={isEdit ? undefined : onSelectFolder}
            className={`flex-1 flex items-center gap-2 px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input min-w-0 ${
              isEdit ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/60 hover:border-primary/20 transition-colors'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
            {path ? (
              <span className="text-foreground truncate">{path}</span>
            ) : (
              <span className="text-foreground">{dp.select_folder}</span>
            )}
          </div>
          {!isEdit && (
            <Button variant="secondary" size="sm" icon={<FolderOpen className="w-3.5 h-3.5" />} onClick={onSelectFolder}>
              {dp.browse}
            </Button>
          )}
        </div>
      </div>

      {/* Project name */}
      <div>
        <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
          {dp.project_name}
          {!isEdit && path && !nameEdited && (
            <span className="typo-caption text-foreground font-normal">({dp.auto_filled_from_folder})</span>
          )}
        </label>
        <div className="relative">
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={dp.project_name_placeholder}
            className="w-full px-3 py-2.5 pr-8 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
          <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
        </div>
      </div>

      {/* Project type */}
      <div>
        <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
          {dp.project_type}
          <span className="typo-caption text-foreground font-normal">({dp.project_type_optional})</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_TYPES.map((pt) => (
            <button
              key={pt.id}
              type="button"
              onClick={() => onTypeChange(pt.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card border transition-all ${
                projectType === pt.id
                  ? `${pt.color} ring-1 ring-current/20`
                  : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
              }`}
            >
              <span>{pt.icon}</span>
              {pt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
