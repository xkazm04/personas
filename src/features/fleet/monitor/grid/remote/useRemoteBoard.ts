// useRemoteBoard — the Activity board's read on remote sessions.
//
// FRESHNESS, and why there is no fast loop. Views arrive by push
// (`network:remote-session-updated`); this hook only reconciles: once on mount,
// on window focus, and on the shared 30 s dashboard cadence WHILE a remote
// session is still live. A board with nothing in flight polls nothing, and a
// build without p2p answers every load from the cached probe without an IPC.

import { useEffect, useMemo } from 'react';
import type { DevProject } from '@/lib/bindings/DevProject';
import { POLLING_CONFIG, usePolling } from '@/hooks/utility/timing/usePolling';
import { isRemoteSessionSettled } from '@/lib/network/remoteSessionModel';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { isTestBuild } from '../simulation/simulationMode';
import { groupRemoteSessions, NO_REMOTE, type RemoteGrouping } from './remoteBoardModel';

// The screenshot fixture (`window.__remoteSessionsFixture`) rides along in dev
// and test-automation builds only, and never in the Monitor's first chunk.
if (import.meta.env.DEV || isTestBuild()) {
  void import('@/stores/slices/network/remoteSessionsFixture')
    .then((m) => m.attachRemoteSessionsFixture())
    .catch(silentCatch('remoteSessions:fixture'));
}

/** Reconcile the remote-session slice on mount and on window focus. */
export function useRemoteSessionsReconcile(enabled: boolean): void {
  const load = useSystemStore((s) => s.loadRemoteSessions);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, load]);
}

export function useRemoteBoard(projects: readonly DevProject[], enabled: boolean): RemoteGrouping {
  const sessions = useSystemStore((s) => s.remoteSessions);
  const load = useSystemStore((s) => s.loadRemoteSessions);
  const views = useMemo(() => Object.values(sessions), [sessions]);
  const anyLive = useMemo(() => views.some((v) => !isRemoteSessionSettled(v)), [views]);

  useRemoteSessionsReconcile(enabled);
  usePolling(load, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: enabled && anyLive,
    name: 'monitor:remoteSessions',
  });

  return useMemo(
    () => (enabled ? groupRemoteSessions(views, projects) : NO_REMOTE),
    [enabled, views, projects],
  );
}
