// Workspaces module — Workspace Knowledge Center shell
// (docs/plans/workspace-knowledge-center.md).
//
// SKELETON: registers the tab end-to-end (store → backend → UI). The real
// shell/library/matrix layouts arrive via the /prototype rounds A–C; strings
// stay hardcoded-EN until consolidation (i18n lands with the winner).
import { Landmark, Plus } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { createWorkspace, setActiveWorkspace, useWorkspaces } from './workspaceStore';

export default function WorkspacesPage() {
  const { workspaces, activeId } = useWorkspaces();

  return (
    <div className="h-full w-full flex flex-col p-6 gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" />
          <h1 className="typo-heading text-foreground">Workspaces</h1>
        </div>
        <Button onClick={() => createWorkspace('New workspace')}>
          <Plus className="w-4 h-4" />
          New workspace
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No workspaces yet"
          description="Group your dev projects into a workspace to build a shared best-practice library across them."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => setActiveWorkspace(ws.id === activeId ? null : ws.id)}
              className={`flex items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors ${
                ws.id === activeId
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-primary/10 hover:bg-secondary/40'
              }`}
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: ws.color }}
              />
              <span className="typo-body text-foreground flex-1">{ws.name}</span>
              <span className="typo-caption text-foreground">
                {ws.projectIds.length} project{ws.projectIds.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
