// remoteBoardModel — where a REMOTE session sits on the Activity board.
//
// A remote session is a fleet session this device sent to a paired device. It
// carries no `cwd` here (the process runs over there), so the board's usual
// cwd -> DevProject -> team_id mapping (`fleetSessionModel.groupSessions`)
// cannot place it. What it carries instead is the project's git remote, which
// is the one key both machines agree on:
//
//   • a local DevProject with the same `github_url` (normalised: protocol,
//     credentials, `.git` and case do not count) that has a team column →
//     the remote tile joins THAT column, under the same divider as the local
//     sessions — the operator reads one project's work in one place;
//   • otherwise → an "On <device>" column, one per device, after the others.
//
// Pure module: no JSX, no i18n, no clock. The state a tile renders comes from
// `effectiveRemoteState` at paint time, not from here.

import type { DevProject } from '@/lib/bindings/DevProject';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { normalizeGitRemote } from '@/lib/network/remoteSessionModel';

export interface RemoteDeviceGroup {
  peerId: string;
  displayName: string;
  views: RemoteSessionView[];
}

export interface RemoteGrouping {
  /** teamId -> the remote sessions for that column's project, newest first. */
  byTeam: Map<string, RemoteSessionView[]>;
  /** One group per device for everything no local project claims. */
  byDevice: RemoteDeviceGroup[];
}

export const NO_REMOTE: RemoteGrouping = { byTeam: new Map(), byDevice: [] };

/** Newest first: the one just sent is the one the operator is looking for. */
function newestFirst(a: RemoteSessionView, b: RemoteSessionView): number {
  return b.createdAtMs - a.createdAtMs || a.jobId.localeCompare(b.jobId);
}

export function groupRemoteSessions(
  views: readonly RemoteSessionView[],
  projects: readonly DevProject[],
): RemoteGrouping {
  if (views.length === 0) return NO_REMOTE;

  const teamByRemote = new Map<string, string>();
  for (const p of projects) {
    const key = normalizeGitRemote(p.github_url);
    if (key && p.team_id && !teamByRemote.has(key)) teamByRemote.set(key, p.team_id);
  }

  const byTeam = new Map<string, RemoteSessionView[]>();
  const devices = new Map<string, RemoteDeviceGroup>();
  for (const v of views) {
    const key = normalizeGitRemote(v.githubUrl);
    const teamId = key ? teamByRemote.get(key) : undefined;
    if (teamId) {
      const list = byTeam.get(teamId);
      if (list) list.push(v);
      else byTeam.set(teamId, [v]);
      continue;
    }
    pushToDevice(devices, v);
  }

  for (const list of byTeam.values()) list.sort(newestFirst);
  return { byTeam, byDevice: sortedDevices(devices) };
}

/**
 * Fold remote sessions whose team has no rendered column (every persona of it
 * is missing from the board, or the board is filtered) into their device
 * groups, so a remote session is never silently dropped.
 */
export function withOrphansOnDevices(
  grouping: RemoteGrouping,
  renderedTeamIds: ReadonlySet<string>,
): RemoteDeviceGroup[] {
  const orphans: RemoteSessionView[] = [];
  for (const [teamId, list] of grouping.byTeam) {
    if (!renderedTeamIds.has(teamId)) orphans.push(...list);
  }
  if (orphans.length === 0) return grouping.byDevice;
  const devices = new Map<string, RemoteDeviceGroup>();
  for (const g of grouping.byDevice) devices.set(g.peerId, { ...g, views: [...g.views] });
  for (const v of orphans) pushToDevice(devices, v);
  return sortedDevices(devices);
}

function pushToDevice(devices: Map<string, RemoteDeviceGroup>, v: RemoteSessionView): void {
  const group = devices.get(v.peerId);
  if (group) group.views.push(v);
  else devices.set(v.peerId, { peerId: v.peerId, displayName: v.peerDisplayName || v.peerId.slice(0, 8), views: [v] });
}

function sortedDevices(devices: Map<string, RemoteDeviceGroup>): RemoteDeviceGroup[] {
  const out = [...devices.values()];
  for (const g of out) g.views.sort(newestFirst);
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.peerId.localeCompare(b.peerId));
}

/** The synthetic column id of a device group; never collides with a team id. */
export function deviceColumnId(peerId: string): string {
  return `remote-device:${peerId}`;
}
