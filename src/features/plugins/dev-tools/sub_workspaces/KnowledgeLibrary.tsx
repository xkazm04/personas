// Knowledge library host — Topics won round B. Owns the item derivation
// (real rows blended with an optional deterministic demo corpus so scale
// behavior is visible before the harvest engine exists) and renders the
// consolidated tree + paginated DataGrid. Demo rows never touch the DB.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { useTranslation } from '@/i18n/useTranslation';

import { CreatePracticeModal } from './CreatePracticeModal';
import { ExtractionMenu } from './ExtractionMenu';
import KnowledgeTree from './KnowledgeTree';
import { generateMockLibrary } from './libraryMock';
import { viewFromRow } from './libraryModel';
import type { Workspace } from './workspaceStore';

export default function KnowledgeLibrary({
  workspace,
  rows,
  projectById,
  onChanged,
}: {
  workspace: Workspace;
  rows: WorkspaceKnowledge[];
  projectById: Map<string, DevProject>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;

  // Default the demo corpus on for near-empty workspaces so the surface never
  // looks broken before harvesting exists; let the user toggle it off.
  const [demo, setDemo] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const useDemo = demo ?? rows.length < 12;

  const items = useMemo(() => {
    const real = rows.map(viewFromRow);
    if (!useDemo) return real;
    return [...real, ...generateMockLibrary(workspace.id, workspace.projectIds)];
  }, [rows, useDemo, workspace.id, workspace.projectIds]);

  const memberProjects = useMemo(
    () =>
      workspace.projectIds
        .map((id) => projectById.get(id))
        .filter((p): p is DevProject => Boolean(p)),
    [workspace.projectIds, projectById],
  );

  return (
    <div className="flex flex-col min-h-0 h-full gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="typo-section-title text-foreground">{w.library_title}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDemo(!useDemo)}
            className={`typo-label rounded-interactive border px-2 py-1 transition-colors ${
              useDemo
                ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
                : 'border-primary/10 text-foreground/70 hover:bg-secondary/40'
            }`}
          >
            {useDemo ? w.demo_on : w.demo_off}
          </button>
          <ExtractionMenu
            workspace={workspace}
            memberProjects={memberProjects}
            onChanged={onChanged}
          />
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            {w.new_practice}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <KnowledgeTree items={items} projectById={projectById} />
      </div>

      {creating && (
        <CreatePracticeModal
          workspaceId={workspace.id}
          memberProjects={memberProjects}
          onClose={() => setCreating(false)}
          onCreated={onChanged}
        />
      )}
    </div>
  );
}
