// Knowledge library host — /prototype ROUND B. Three scale-first variants
// behind a throwaway switcher (the winner consolidates):
//   Ledger — one virtualized register, re-groupable along any derived facet
//   Topics — the emergent slash-path taxonomy as a navigable tree
//   Inbox  — governance-first: influx, review queue w/ inline verdicts, canon
// A demo-data toggle blends a deterministic ~260-item corpus (9 months of
// simulated harvesting) with the real rows so scale behavior is visible
// before the harvest engine exists. Demo rows never touch the DB.
import { useMemo, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

import KnowledgeInbox from './KnowledgeInbox';
import KnowledgeLedger from './KnowledgeLedger';
import KnowledgeTree from './KnowledgeTree';
import { generateMockLibrary } from './libraryMock';
import { viewFromRow } from './libraryModel';
import type { Workspace } from './workspaceStore';

type LibraryVariant = 'ledger' | 'topics' | 'inbox';

const VARIANT_TABS: { id: LibraryVariant; label: string }[] = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'topics', label: 'Topics' },
  { id: 'inbox', label: 'Inbox' },
];

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
  const [variant, setVariant] = useState<LibraryVariant>('ledger');
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
        <div className="flex items-center gap-3">
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
          <SegmentedTabs
            tabs={VARIANT_TABS}
            activeTab={variant}
            onTabChange={setVariant}
            variant="segment"
            size="sm"
            ariaLabel="Library variant"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {variant === 'ledger' && (
          <KnowledgeLedger items={items} projectById={projectById} workspaceId={workspace.id} />
        )}
        {variant === 'topics' && (
          <KnowledgeTree items={items} projectById={projectById} workspaceId={workspace.id} />
        )}
        {variant === 'inbox' && (
          <KnowledgeInbox
            items={items}
            projectById={projectById}
            workspaceId={workspace.id}
            onDecided={onChanged}
          />
        )}
      </div>
    </div>
  );
}
