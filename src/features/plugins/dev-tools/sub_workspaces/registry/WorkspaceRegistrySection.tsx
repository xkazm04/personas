// The workspace's knowledge-registry section in the Atlas detail band.
//
// Direction settled: **Shared holding**. A registry is a jointly-held asset, not
// a per-territory feed — the cardinality is 1 registry : N workspaces, and the
// competing direction could not show that at all. Its resting state read
// identically whether this workspace was the only holder or the fourth, which
// made "disconnect" look equally safe in both cases.
//
// Registry wiring lives at WORKSPACE level, not project level: one registry
// serves every project in the territory, and one registry can serve several
// workspaces.

import { useSyncExternalStore } from 'react';
import { Library } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { Workspace } from '../workspaceStore';
import { RegistryHolding } from './RegistryHolding';
import { registryFor, registryLinkSnapshot, subscribeRegistryLinks } from './registryLinkStore';

export function WorkspaceRegistrySection({
  workspace,
  workspaces,
  projectById,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  projectById: Map<string, DevProject>;
}) {
  const { t } = useTranslation();

  // The store is a plain external source; subscribing here keeps the section
  // live without the presentational component owning the subscription.
  useSyncExternalStore(subscribeRegistryLinks, registryLinkSnapshot, registryLinkSnapshot);
  const registry = registryFor(workspace.id);

  // The pairing task needs a directory that EXISTS. The registry working copy
  // may not be there yet, so the session starts in a member project instead.
  const dispatchCwd =
    workspace.projectIds.map((id) => projectById.get(id)?.root_path).find((p): p is string => Boolean(p)) ?? null;

  const workspaceNameById = new Map(workspaces.map((w) => [w.id, w.name]));

  return (
    <section className="flex flex-col gap-3 border-t border-primary/10 pt-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 typo-title text-foreground">
          <Library className="w-4 h-4 text-foreground" aria-hidden />
          {t.plugins.dev_tools.registry.section_title}
        </span>
      </header>

      <RegistryHolding
        workspaceId={workspace.id}
        registry={registry}
        dispatchCwd={dispatchCwd}
        workspaceNameById={workspaceNameById}
      />
    </section>
  );
}
