/**
 * Add an app to Server control by picking one of the operator's projects,
 * grouped by workspace. A repository that is not a project yet is created
 * through the shared ProjectModal (the Projects manager's own dialog) and put
 * in at once. There is no free-text path: Server control only ever runs
 * registered projects.
 *
 * Picking returns at once. Rust assigns a free port and starts the AI scan;
 * the new server arrives through `dev-servers-changed` in state `scanning`, so
 * the modal closes on success and never waits for the scan itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useContextScanBackground } from '@/features/plugins/dev-tools/hooks/useContextScanBackground';
import { ProjectModal } from '@/features/plugins/dev-tools/sub_projects/ProjectModal';
import { useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import Button from '@/features/shared/components/buttons/Button';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { DevProject } from '@/lib/bindings/DevProject';
import { extractMessage } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useSystemStore } from '@/stores/systemStore';

import AddAppProjectList from './AddAppProjectList';
import { addAppGroups } from './addAppModel';
import { useDevServers } from './devServerStore';
import { useAddAppActions } from './useAddAppActions';

export default function AddAppModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const projects = useSystemStore(useShallow((st) => st.projects));
  const fetchProjects = useSystemStore((st) => st.fetchProjects);
  const { workspaces } = useWorkspaces();
  const { byProject } = useDevServers();
  const { addProject, createAndAdd } = useAddAppActions();
  const { startBackgroundScan } = useContextScanBackground();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The raw refusal; resolved to the product's sentence where it is rendered. */
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setAdding(null);
    setFailure(null);
    if (useSystemStore.getState().projects.length === 0) void fetchProjects();
  }, [isOpen, fetchProjects]);

  const inView = useMemo(() => new Set(byProject.keys()), [byProject]);
  const groups = useMemo(() => addAppGroups(projects, workspaces, inView, query), [projects, workspaces, inView, query]);

  const pick = async (project: DevProject) => {
    setFailure(null);
    setAdding(project.id);
    try {
      await addProject(project);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setAdding(null);
    }
  };

  return (
    <>
      <BaseModal isOpen={isOpen && !creating} onClose={onClose} titleId="server-add-app-title" size="lg" portal>
        <div className="p-6 flex flex-col gap-4" data-testid="server-add-app-modal">
          <div>
            <h2 id="server-add-app-title" className="typo-title-lg">
              {s.add_title}
            </h2>
            <p className="mt-1 flex items-start gap-2 typo-body text-foreground">
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
              {s.add_scan_hint}
            </p>
          </div>

          <label className="relative block">
            <span className="sr-only">{s.add_search}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.add_search}
              className={`${INPUT_FIELD} pl-9`}
              data-testid="server-add-search"
            />
          </label>

          <AddAppProjectList
            groups={groups}
            adding={adding}
            onPick={(p) => void pick(p)}
            emptyTitle={query.trim() ? s.add_none_match : s.add_all_added}
          />

          {failure !== null && (
            <div data-testid="server-add-error">
              <InlineErrorBanner compact title={s.add_failed} message={resolveErrorTranslated(t, extractMessage(failure)).message} />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setCreating(true)}
              data-testid="server-add-new-project"
            >
              {s.add_new_project}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      </BaseModal>

      <ProjectModal
        open={isOpen && creating}
        onClose={() => setCreating(false)}
        onCreate={async (data) => {
          const created = await createAndAdd(data);
          if (created) {
            setCreating(false);
            onClose();
          }
          return created;
        }}
        onUpdate={async () => {}}
        onScanNow={startBackgroundScan}
        editProject={null}
      />
    </>
  );
}
