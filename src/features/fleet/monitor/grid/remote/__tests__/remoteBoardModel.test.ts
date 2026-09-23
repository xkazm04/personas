import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../../../monitorModel';
import { useBoardModel } from '../../useBoardModel';
import { deviceColumnId, groupRemoteSessions, withOrphansOnDevices } from '../remoteBoardModel';

const project = (over: Partial<DevProject>): DevProject => ({ id: 'p', name: 'repo', root_path: '/r', github_url: null, team_id: null, ...over } as DevProject);

const view = (jobId: string, over: Partial<RemoteSessionView> = {}): RemoteSessionView => ({
  jobId, sessionId: null, peerId: 'peer-1', peerDisplayName: 'Studio Desktop', projectId: 'x',
  projectLabel: 'repo', githubUrl: 'https://github.com/o/r', title: null, state: 'running', stateReason: null,
  mode: 'headless', createdAtMs: 1, lastActivityMs: 1, mirrorAtMs: 1, jobStatus: 'running', receipt: null, ...over,
});

describe('groupRemoteSessions', () => {
  it('joins the project column whose local project shares the git remote', () => {
    const projects = [project({ id: 'p1', github_url: 'git@github.com:o/r.git', team_id: 'team-a' })];
    const g = groupRemoteSessions([view('j1')], projects);
    expect(g.byTeam.get('team-a')?.map((v) => v.jobId)).toEqual(['j1']);
    expect(g.byDevice).toEqual([]);
  });

  it('lands in "On <device>" when no local project matches', () => {
    const projects = [project({ id: 'p1', github_url: 'https://github.com/other/repo', team_id: 'team-a' })];
    const g = groupRemoteSessions([view('j1'), view('j2', { peerId: 'peer-2', peerDisplayName: 'Laptop' })], projects);
    expect(g.byTeam.size).toBe(0);
    expect(g.byDevice.map((d) => [d.displayName, d.views.map((v) => v.jobId)])).toEqual([
      ['Laptop', ['j2']],
      ['Studio Desktop', ['j1']],
    ]);
  });

  it('a matching project with no team column still lands on the device', () => {
    const projects = [project({ id: 'p1', github_url: 'https://github.com/o/r', team_id: null })];
    expect(groupRemoteSessions([view('j1')], projects).byDevice).toHaveLength(1);
  });

  it('folds a team without a rendered column back onto its device', () => {
    const projects = [project({ id: 'p1', github_url: 'https://github.com/o/r', team_id: 'team-gone' })];
    const g = groupRemoteSessions([view('j1')], projects);
    expect(withOrphansOnDevices(g, new Set(['team-a']))[0]?.views.map((v) => v.jobId)).toEqual(['j1']);
  });
});

describe('useBoardModel with remote sessions', () => {
  const persona = (id: string, team: string) => ({ id, home_team_id: team } as unknown as Persona);
  const card = (id: string) => ({ personaId: id, square: 'idle' } as unknown as PersonaCardModel);
  const team = (id: string) => ({ id, name: id, color: '#fff' } as unknown as PersonaTeam);
  const noSessions = { byTeam: new Map<string, FleetSession[]>(), ungrouped: [] as FleetSession[] };

  it('adds remote rows under the project column and a trailing device column', () => {
    const projects = [project({ id: 'p1', github_url: 'https://github.com/o/r', team_id: 'team-a' })];
    const remote = groupRemoteSessions(
      [view('j1'), view('j2', { githubUrl: 'https://github.com/elsewhere/x' })],
      projects,
    );
    const { result } = renderHook(() =>
      useBoardModel([card('a1')], [persona('a1', 'team-a')], [team('team-a')], noSessions, undefined, remote),
    );
    const cols = result.current.columns;
    expect(cols.map((c) => c.teamId)).toEqual(['team-a', deviceColumnId('peer-1')]);
    expect(cols[0]!.rows.map((r) => r.key)).toEqual(['p:a1', 'divider', 'remote:j1']);
    expect(cols[1]!.rows.map((r) => r.key)).toEqual(['remote:j2']);
    expect(cols[1]!.remoteDevice).toEqual({ peerId: 'peer-1', displayName: 'Studio Desktop' });
  });

  it('adds nothing at all when there are no remote sessions', () => {
    const { result } = renderHook(() =>
      useBoardModel([card('a1')], [persona('a1', 'team-a')], [team('team-a')], noSessions),
    );
    expect(result.current.columns.map((c) => c.teamId)).toEqual(['team-a']);
    expect(result.current.columns[0]!.rows.map((r) => r.key)).toEqual(['p:a1']);
  });
});
