// Which registry checkout does the Council page draw?
//
// A registry is wired at WORKSPACE level (`registryLinkStore`), and the
// Council page is not scoped to a project the way Dev Tools is — it spans
// every council in the store. So: the active project's workspace registry
// when there is one, and otherwise the knowledge-lane holder with the lowest
// id, which is exactly the registry the Rust side already consults (see
// `registryLinkStore.syncKnowledgeRootSetting`). Returning `null` is a
// first-class answer meaning "nothing is paired", never "the corpus is empty".
import { useSyncExternalStore } from 'react';

import {
  registryLinkSnapshot,
  subscribeRegistryLinks,
} from '@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import { useSystemStore } from '@/stores/systemStore';

function fallbackRoot(): string | null {
  const holder = Object.values(registryLinkSnapshot().registries)
    .filter((r) => r.lanes.includes('knowledge') && r.clonePath.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return holder?.clonePath ?? null;
}

export function useRegistryRoot(): string | null {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  useSyncExternalStore(subscribeRegistryLinks, registryLinkSnapshot, registryLinkSnapshot);
  return corpusRootFor(activeProjectId) ?? fallbackRoot();
}
