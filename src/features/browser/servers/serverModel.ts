// Shared read-side helpers for every Server control variant and the Monitor
// bay, so four prototypes do not each derive uptime, grouping or workspace
// colour their own way.

import { useEffect, useMemo, useState } from 'react';

import { useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { formatDuration } from '@/lib/utils/formatters';

export interface WorkspaceTag {
  name: string;
  color: string;
}

/** workspace id -> name + colour, from the one workspace store. */
export function useWorkspaceIndex(): ReadonlyMap<string, WorkspaceTag> {
  const { workspaces } = useWorkspaces();
  return useMemo(() => new Map(workspaces.map((w) => [w.id, { name: w.name, color: w.color }])), [workspaces]);
}

/**
 * A clock that ticks only while something on screen needs it. `startedAt` is a
 * stamp, so uptime is derived here, never pushed from Rust every second.
 */
export function useNowSeconds(active: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    setNow(Math.floor(Date.now() / 1000));
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** "2h 14m", or null when the server has no start stamp. */
export function formatUptime(startedAt: number | null, nowSeconds: number): string | null {
  if (startedAt == null) return null;
  return formatDuration(Math.max(0, nowSeconds - startedAt), { unit: 's' });
}

/** Tech stack tokens from the comma-separated column. */
export function techTokens(server: Pick<DevServerView, 'techStack'>): string[] {
  return (server.techStack ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ServerGroup {
  /** null = no workspace. */
  workspaceId: string | null;
  servers: DevServerView[];
}

/** Group by workspace in the list's own order (Rust sorts by workspace, then name). */
export function groupByWorkspace(servers: readonly DevServerView[]): ServerGroup[] {
  const groups: ServerGroup[] = [];
  const index = new Map<string | null, ServerGroup>();
  for (const server of servers) {
    let group = index.get(server.workspaceId);
    if (!group) {
      group = { workspaceId: server.workspaceId, servers: [] };
      index.set(server.workspaceId, group);
      groups.push(group);
    }
    group.servers.push(server);
  }
  return groups;
}
