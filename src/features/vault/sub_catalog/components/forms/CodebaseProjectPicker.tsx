import { useState, useEffect } from 'react';
import { Code2, ArrowRight, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('codebase-project-picker');
import { listProjects } from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';
import { ProjectList } from './ProjectList';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
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
        logger.error('Failed to load projects', { error: String(err) });
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
          <p className="typo-body font-medium text-foreground">{t.common.no_results}</p>
          <p className="typo-caption text-foreground max-w-xs">
            Add a project in Dev Tools first to connect a codebase to your agents.
          </p>
        </div>
        <button
          type="button"
          onClick={goToDevTools}
          className="flex items-center gap-2 px-4 py-2 rounded-card typo-body font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/25 transition-colors"
        >
          Go to Dev Tools
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="typo-caption text-foreground hover:text-foreground/70 transition-colors"
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
          <label className="block typo-body font-medium text-foreground mb-1.5">
            Credential Name
          </label>
          <input
            type="text"
            value={credentialName ?? ''}
            onChange={(e) => onCredentialNameChange(e.target.value)}
            placeholder={multiSelect ? 'My Codebases' : 'My Codebase'}
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground typo-body placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
          />
        </div>
      )}

      <p className="typo-caption text-foreground">
        {multiSelect
          ? 'Select projects to include in cross-project analysis.'
          : 'Select a project to connect as a codebase source for your agents.'}
      </p>

      <ProjectList
        projects={projects}
        isSelected={isSelected}
        onSelect={handleSelect}
        multiSelect={multiSelect}
      />

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasSelection}
          className="flex-1 px-4 py-2 rounded-card typo-body font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {multiSelect ? `Connect ${selectedIds.size} Project${selectedIds.size !== 1 ? 's' : ''}` : 'Connect Project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-card typo-body text-foreground hover:text-foreground/70 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
