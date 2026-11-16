import { useState, useEffect, useCallback } from 'react';
import { Code2, ArrowRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('codebase-project-picker');
import { listProjects } from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';
import { ProjectList } from './ProjectList';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';


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
  const ps = t.vault.picker_section;
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);
  // The raw rejection, resolved at render: listProjects rejects with a
  // serialized AppError OBJECT, which `String(err)` painted as "[object Object]".
  const [loadError, setLoadError] = useState<{ raw: unknown } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load (or reload on Retry). Tracks load failure separately from
  // 'no projects exist' so the empty-state UI can distinguish a real
  // empty workspace from a transient IPC failure — previously both
  // showed the same 'go to dev tools' screen, which led users to
  // re-create projects that already existed.
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listProjects('active');
      setProjects(result);
    } catch (err) {
      logger.error('Failed to load projects', { error: extractMessage(err) });
      setLoadError({ raw: err });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

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

  const isSelected = (id: string) => multiSelect ? selectedIds.has(id) : selectedId === id;
  const hasSelection = multiSelect ? selectedIds.size > 0 : !!selectedId;
  const showGhost = loading && projects.length === 0 && !loadError;

  return (
    <div className="space-y-4">
      {onCredentialNameChange && (
        <div>
          <label className="block typo-body text-foreground mb-1.5">
            {ps.credential_name}
          </label>
          <input
            type="text"
            value={credentialName ?? ''}
            onChange={(e) => onCredentialNameChange(e.target.value)}
            placeholder={multiSelect ? 'My Codebases' : 'My Codebase'}
            className="w-full px-3 py-2 bg-background/50 border border-hair rounded-modal text-foreground typo-body placeholder:text-ink-3 focus-ring focus-visible:border-primary/40 transition-all"
          />
        </div>
      )}

      {loadError ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="w-14 h-14 rounded-card bg-status-warning/10 border border-status-warning/15 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-status-warning/80" />
          </div>
          <div className="space-y-1">
            <p className="typo-body text-foreground"><DebtText k="auto_couldn_t_load_projects_c5a25bd3" /></p>
            <p className="typo-caption text-foreground max-w-xs break-words">{resolveErrorTranslated(t, extractMessage(loadError.raw)).message}</p>
          </div>
          <Button
            type="button"
            onClick={() => void loadProjects()}
            variant="accent"
            tone="warning"
            size="md"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </Button>
        </div>
      ) : !loading && projects.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="w-14 h-14 rounded-card bg-role-agent/10 border border-role-agent/15 flex items-center justify-center">
            <Code2 className="w-7 h-7 text-role-agent/60" />
          </div>
          <div className="space-y-1">
            <p className="typo-body text-foreground">{t.common.no_results}</p>
            <p className="typo-caption text-foreground max-w-xs">
              {ps.add_project_first}
            </p>
          </div>
          <Button
            type="button"
            onClick={goToDevTools}
            variant="secondary"
            size="md"
            iconRight={<ArrowRight className="w-3.5 h-3.5" />}
          >
            {ps.go_to_dev_tools}
          </Button>
        </div>
      ) : (
        <>
          <p className="typo-caption text-foreground">
            {multiSelect
              ? 'Select projects to include in cross-project analysis.'
              : 'Select a project to connect as a codebase source for your agents.'}
          </p>

          {showGhost ? (
            <ProjectListGhost />
          ) : (
            <ProjectList
              projects={projects}
              isSelected={isSelected}
              onSelect={handleSelect}
              multiSelect={multiSelect}
            />
          )}
        </>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!hasSelection}
          variant="ghost"
          size="md"
          className="flex-1"
        >
          {multiSelect ? `Connect ${selectedIds.size} Project${selectedIds.size !== 1 ? 's' : ''}` : 'Connect Project'}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          variant="ghost"
          size="md"
        >
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

function ProjectListGhost() {
  const widths = ['w-40', 'w-32', 'w-48'];
  return (
    <div aria-hidden="true" className="space-y-2 max-h-64 overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="w-full flex items-start gap-3 p-3 rounded-modal border border-hair animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-5 h-5 mt-0.5 rounded-interactive bg-primary/[0.06] shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className={`block h-3.5 rounded-interactive bg-primary/[0.06] ${widths[i % widths.length]}`} />
            <span className="block h-2.5 w-56 rounded-interactive bg-primary/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}
