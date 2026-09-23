// Which registry checkout does the Council page draw?
//
// A registry is wired at WORKSPACE level (`registryLinkStore`), and the
// Council page is not scoped to a project the way Dev Tools is — it spans
// every council in the store. So: the active project's workspace registry
// when there is one, and otherwise the knowledge root the BACKEND picked.
//
// That second half used to be a second local copy of the "knowledge lane,
// lowest id, non-blank path" pick that the Rust side also implemented. Two
// copies of a pick mean two surfaces can name two different
// corpora for one wiring, so there is one copy now
// (`repos::dev_registries::knowledge_root`) and it arrives on the snapshot.
//
// Returning `null` is a first-class answer meaning "nothing is paired", never
// "the corpus is empty".
import { useSyncExternalStore } from 'react';

import {
  registryLinkSnapshot,
  subscribeRegistryLinks,
} from '@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import { useSystemStore } from '@/stores/systemStore';

export function useRegistryRoot(): string | null {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const links = useSyncExternalStore(
    subscribeRegistryLinks,
    registryLinkSnapshot,
    registryLinkSnapshot,
  );
  return corpusRootFor(activeProjectId) ?? links.knowledgeRoot;
}
