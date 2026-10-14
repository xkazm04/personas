// The device filter on the Activity board (spark device-mesh).
//
//  - no paired device: the board is exactly what it was, whatever the filter;
//  - 'All' adds one column per LIVE peer, and folds that peer's "On <device>"
//    column of sent sessions into it; a stale peer gets no column;
//  - a peer filter shows only that peer (live or not), with every session this
//    device sent it, and nothing local;
//  - 'This device' is the board unchanged.

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import type { PersonaCardModel } from '../../monitorModel';
import { groupSessions } from '../fleetSessionModel';
import { groupRemoteSessions } from '../remote/remoteBoardModel';
import { NO_MESH, useBoardModel, type MeshBoardInput } from '../useBoardModel';

const card = (personaId: string): PersonaCardModel => ({ personaId, personaName: personaId } as unknown as PersonaCardModel);
const team = (id: string): PersonaTeam => ({ id, name: id, color: '#fff', project_id: `proj-${id}` } as unknown as PersonaTeam);
const persona = (id: string, teamId: string) => ({ id, home_team_id: teamId } as never);

const device = (peerId: string, over: Partial<MeshDeviceView> = {}): MeshDeviceView => ({
  peerId, displayName: peerId, isSelf: false, isHome: false, reachability: 'connected', liveness: 'live',
  receivedAtMs: 1, lastProbe: null,
  snapshot: {
    peerId, displayName: peerId, appVersion: '1', sentAtMs: 1, host: { cpuShare: 0.1, ramShare: 0.1, gpuShare: null },
    running: 0, queued: 1,
    agents: [{ personaId: `${peerId}-agent`, name: 'Agent', enabled: true, projectId: null, projectEnabled: null, dominant: 'cpu', running: false }],
    queue: [{ sessionId: `${peerId}-q`, title: 'Queued', projectLabel: null, rank: 1, machineUnits: 1, gpu: 'none' }],
  },
  ...over,
});

const sent = (jobId: string, peerId: string): RemoteSessionView => ({
  jobId, sessionId: null, peerId, peerDisplayName: peerId, projectId: 'x', projectLabel: 'x',
  githubUrl: 'https://github.com/elsewhere/repo', title: jobId, state: 'running', stateReason: null, mode: 'headless',
  createdAtMs: 1, lastActivityMs: 1, mirrorAtMs: 1, jobStatus: 'running', receipt: null,
});

const SELF = device('me', { isSelf: true });
const mesh = (filter: string, devices: MeshDeviceView[], liveness: Record<string, 'live' | 'unknown'>): MeshBoardInput =>
  ({ devices, liveness, filter });

function board(meshInput: MeshBoardInput, remotes: RemoteSessionView[] = []) {
  const sessions = groupSessions([], []);
  const remote = groupRemoteSessions(remotes, []);
  return renderHook(() => useBoardModel(
    [card('p1')], [persona('p1', 't1')], [team('t1')], sessions, undefined, remote, meshInput,
  )).result.current;
}

describe('the board device filter', () => {
  it('without a paired device the board is unchanged, whatever the filter says', () => {
    const plain = board(NO_MESH);
    const onlySelf = board(mesh('me', [SELF], { me: 'live' }));
    expect(onlySelf.columns.map((c) => c.teamId)).toEqual(plain.columns.map((c) => c.teamId));
    expect(onlySelf.peerColumns).toEqual([]);
    expect(onlySelf.peerScope).toBeNull();
    expect(board(mesh('all', [], {})).peerColumns).toEqual([]);
  });

  it("'All' adds one column per live peer and none for a stale one", () => {
    const m = board(mesh('all', [SELF, device('a'), device('b')], { me: 'live', a: 'live', b: 'unknown' }));
    expect(m.columns.map((c) => c.teamId)).toEqual(['t1']);
    expect(m.peerColumns.map((p) => p.peerId)).toEqual(['a']);
    expect(m.peerColumns[0]).toMatchObject({ stale: false, agents: [{ personaId: 'a-agent' }], queue: [{ sessionId: 'a-q' }] });
    expect(m.peerScope).toBeNull();
  });

  it("'All' folds a live peer's sent-sessions column into its device column", () => {
    const m = board(mesh('all', [SELF, device('a'), device('b')], { a: 'live', b: 'unknown' }), [sent('j1', 'a'), sent('j2', 'b')]);
    // b is stale: its "On b" column stays where it was; a's is folded into a's column.
    expect(m.columns.map((c) => c.remoteDevice?.peerId ?? c.teamId)).toEqual(['t1', 'b']);
    expect(m.peerColumns[0]?.remotes.map((v) => v.jobId)).toEqual(['j1']);
  });

  it('a peer filter shows only that peer, stale or not, with every session sent to it', () => {
    const m = board(mesh('b', [SELF, device('a'), device('b')], { a: 'live', b: 'unknown' }), [sent('j1', 'a'), sent('j2', 'b')]);
    expect(m.columns).toEqual([]);
    expect(m.ungrouped).toEqual([]);
    expect(m.traySessions).toEqual([]);
    expect(m.peerScope).toBe('b');
    expect(m.peerColumns.map((p) => [p.peerId, p.stale])).toEqual([['b', true]]);
    expect(m.peerColumns[0]?.remotes.map((v) => v.jobId)).toEqual(['j2']);
    expect(m.empty).toBe(false);
  });

  it("'This device' is the board unchanged", () => {
    const plain = board(NO_MESH, [sent('j1', 'a')]);
    const self = board(mesh('me', [SELF, device('a')], { a: 'live' }), [sent('j1', 'a')]);
    expect(self.columns.map((c) => c.teamId)).toEqual(plain.columns.map((c) => c.teamId));
    expect(self.peerColumns).toEqual([]);
  });

  it('a filter naming a device that left the mesh reads as All', () => {
    const m = board(mesh('gone', [SELF, device('a')], { a: 'live' }));
    expect(m.peerScope).toBeNull();
    expect(m.peerColumns.map((p) => p.peerId)).toEqual(['a']);
    expect(m.columns.map((c) => c.teamId)).toEqual(['t1']);
  });
});
