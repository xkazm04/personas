// A bay's dev server: the Server control row for the bay's project, or null
// when the project has no server configured (no `dev_port`). Every bay reads
// the ONE module store Browser > Server control reads, so forty bays share one
// subscription and one fetch. The store re-adopts the whole list on every
// event, so every row is a new object each time; the selector keeps the old
// one while the fields a bay draws or acts on are unchanged, and a bay
// repaints only when ITS server does.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import {
  devServersSnapshot, ensureDevServers, subscribeDevServers,
} from '@/features/browser/servers/devServerStore';
import type { DevServerView } from '@/lib/bindings/DevServerView';

const same = (a: DevServerView | null, b: DevServerView | null): boolean =>
  a === b || (a !== null && b !== null && a.projectId === b.projectId && a.state === b.state && a.devPort === b.devPort
    && a.url === b.url && a.devCommand === b.devCommand);

export function useBayServer(projectId: string | null): DevServerView | null {
  useEffect(() => { void ensureDevServers(); }, []);
  const last = useRef<DevServerView | null>(null);
  const read = useCallback((): DevServerView | null => {
    const next = projectId ? devServersSnapshot().byProject.get(projectId) ?? null : null;
    if (!same(last.current, next)) last.current = next;
    return last.current;
  }, [projectId]);
  return useSyncExternalStore(subscribeDevServers, read);
}
