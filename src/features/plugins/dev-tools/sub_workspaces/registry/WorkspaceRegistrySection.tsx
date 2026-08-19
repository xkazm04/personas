// PROTOTYPE SWITCHER — throwaway. Deleted when a direction wins; the winner then
// renders directly from the Atlas detail band.
//
// Both directions receive the identical registry and the identical setup flow
// (`RegistryWiring`), so neither can win on data or on the part of the brief that
// is already fixed. What they are actually competing over is the RESTING state:
// whether a wired registry reads as a feed into this territory, or as a holding
// this workspace shares with others.

import { useState, useSyncExternalStore } from 'react';
import { Library } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { Workspace } from '../workspaceStore';
import { RegistryHolding } from './RegistryHolding';
import { RegistrySupplyLine } from './RegistrySupplyLine';
import { registryFor, registryLinkSnapshot, subscribeRegistryLinks } from './registryLinkStore';

type Direction = 'supply' | 'holding';

export function WorkspaceRegistrySection({
  workspace,
  workspaces,
  projectById,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  projectById: Map<string, DevProject>;
}) {
  const [direction, setDirection] = useState<Direction>('supply');

  // The store is a plain external source; subscribing here keeps both directions
  // live without either owning the subscription.
  useSyncExternalStore(subscribeRegistryLinks, registryLinkSnapshot, registryLinkSnapshot);
  const registry = registryFor(workspace.id);

  // The pairing task needs a directory that EXISTS. The registry clone does not
  // yet, so the session starts in the workspace's first member project.
  const dispatchCwd =
    workspace.projectIds.map((id) => projectById.get(id)?.root_path).find((p): p is string => Boolean(p)) ?? null;

  const workspaceNameById = new Map(workspaces.map((w) => [w.id, w.name]));

  return (
    <section className="flex flex-col gap-3 border-t border-primary/10 pt-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 typo-title text-foreground">
          <Library className="w-4 h-4 text-foreground/60" aria-hidden />
          Knowledge registry
        </span>
        <div className="ml-auto">
          <SegmentedTabs<Direction>
            tabs={[
              { id: 'supply', label: 'Supply line' },
              { id: 'holding', label: 'Shared holding' },
            ]}
            activeTab={direction}
            onTabChange={setDirection}
          />
        </div>
      </header>

      {direction === 'supply' ? (
        <RegistrySupplyLine workspaceId={workspace.id} registry={registry} dispatchCwd={dispatchCwd} />
      ) : (
        <RegistryHolding
          workspaceId={workspace.id}
          registry={registry}
          dispatchCwd={dispatchCwd}
          workspaceNameById={workspaceNameById}
        />
      )}
    </section>
  );
}
