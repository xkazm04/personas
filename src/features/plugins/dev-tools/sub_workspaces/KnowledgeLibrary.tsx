// Knowledge library host — Topics won round B. Owns the item derivation
// (real rows blended with an optional deterministic demo corpus so scale
// behavior is visible before the harvest engine exists) and renders the
// consolidated tree + paginated DataGrid. Demo rows never touch the DB.
import { useMemo, useState } from 'react';

import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

import KnowledgeTree from './KnowledgeTree';
import { generateMockLibrary } from './libraryMock';
import { viewFromRow } from './libraryModel';
import type { Workspace } from './workspaceStore';

export default function KnowledgeLibrary({
  workspace,
  rows,
  projectById,
}: {
  workspace: Workspace;
  rows: WorkspaceKnowledge[];
  projectById: Map<string, DevProject>;
}) {
  // Default the demo corpus on for near-empty workspaces so the surface never
  // looks broken before harvesting exists; let the user toggle it off.
  const [demo, setDemo] = useState<boolean | null>(null);
  const useDemo = demo ?? rows.length < 12;

  const items = useMemo(() => {
    const real = rows.map(viewFromRow);
    if (!useDemo) return real;
    return [...real, ...generateMockLibrary(workspace.id, workspace.projectIds)];
  }, [rows, useDemo, workspace.id, workspace.projectIds]);

  return (
    <div className="flex flex-col min-h-0 h-full gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="typo-section-title text-foreground">Knowledge library</h2>
        <button
          type="button"
          onClick={() => setDemo(!useDemo)}
          className={`typo-label rounded-interactive border px-2 py-1 transition-colors ${
            useDemo
              ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
              : 'border-primary/10 text-foreground/70 hover:bg-secondary/40'
          }`}
        >
          {useDemo ? 'Demo corpus on' : 'Demo corpus off'}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <KnowledgeTree items={items} projectById={projectById} />
      </div>
    </div>
  );
}
