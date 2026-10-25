// @vitest-environment node
// An App Master's dispatched sessions land in its project's bay (polish P1, item 3).
// The fixture is shaped like the live FireTV rows of 2026-10-16: the App Master
// persona of project X, two CLI builders it dispatched through the fleet door,
// each in a worktree of its own, with no persona id on the row.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { groupSessions } from '../fleetSessionModel';
import { claimByPersona, cliMasterSlug, personaHomes, projectSlug, slugify } from '../sessionHome';
import { compareSessions } from '../fleetSessionModel';

function session(o: Partial<FleetSession> & { id: string }): FleetSession {
  return {
    claudeSessionId: null, cwd: 'C:/repo', projectLabel: 'repo', name: null, title: null,
    args: [], mode: 'headless', state: 'running' as FleetSessionState,
    lastActivityMs: 0n, lastPtyOutputMs: 0n, lastGrewMs: 0n, createdAtMs: 0n,
    childPid: null, exitCode: null, stateReason: null, athenaActive: false, dozing: false,
    limitResetAtMs: null, staleKind: null, runLabel: null, runId: null, contestId: null,
    contestProjectId: null, personaId: null, origin: null,
    ...o,
  } as unknown as FleetSession;
}

const project = (name: string, root: string, teamId: string | null): DevProject =>
  ({ id: `dp-${name}`, name, root_path: root, team_id: teamId } as unknown as DevProject);

const PROJECTS = [
  project('Study Desk (firetv)', 'C:\\Users\\op\\kiro\\firetv', 't-firetv'),
  project('personas', 'C:\\Users\\op\\kiro\\personas', 't-personas'),
];
const WT = 'C:\\Users\\op\\.personas\\headless-masters\\worktrees\\firetv';
const FIRETV_CLIS = [
  session({ id: 'baff8c62', cwd: `${WT}\\b3b1192c`, runLabel: 'fleet-door:app_master:cli-master:firetv', origin: 'app_master', createdAtMs: 20n }),
  session({ id: 'a6c6bdae', cwd: `${WT}\\856ee620`, runLabel: 'fleet-door:app_master:cli-master:firetv', origin: 'app_master', createdAtMs: 10n }),
];

describe('an App Master\'s CLI builders join its project\'s bay', () => {
  it('reads the project slug out of the fleet door\'s cli-master label', () => {
    expect(cliMasterSlug('fleet-door:app_master:cli-master:firetv')).toBe('firetv');
    expect(cliMasterSlug('cli-master:kp')).toBe('kp');
    expect(cliMasterSlug('fleet-door:lens_scan:bp nightly')).toBeNull();
    expect(cliMasterSlug('app-master:p1')).toBeNull();
    expect(cliMasterSlug(null)).toBeNull();
    expect(cliMasterSlug('fleet-door:app_master:cli-master:')).toBeNull();
  });

  it('names a project by its root\'s last segment, as the skill does', () => {
    expect(projectSlug(PROJECTS[0]!)).toBe('firetv');
    expect(projectSlug({ name: 'CandiDate', root_path: 'C:/work/kp/' })).toBe('kp');
    expect(projectSlug({ name: 'My Project', root_path: '' })).toBe('my-project');
  });

  it('FireTV: both CLIs leave Ungrouped for the FireTV bay, attention-first then newest', () => {
    const before = groupSessions(FIRETV_CLIS, []);
    expect(before.ungrouped.map((s) => s.id)).toEqual(['baff8c62', 'a6c6bdae']);
    const g = groupSessions(FIRETV_CLIS, PROJECTS);
    expect(g.ungrouped).toEqual([]);
    expect(g.byTeam.get('t-firetv')!.map((s) => s.id)).toEqual(['baff8c62', 'a6c6bdae']);
  });

  it('a cwd that matches a project still wins over the label', () => {
    const s = session({ id: 'x', cwd: 'C:\\Users\\op\\kiro\\personas', runLabel: 'fleet-door:app_master:cli-master:firetv' });
    expect(groupSessions([s], PROJECTS).byTeam.get('t-personas')!.map((r) => r.id)).toEqual(['x']);
  });

  it('a slug two projects on different teams share names neither: the session stays visible in the tray', () => {
    const twins = [...PROJECTS, project('firetv fork', 'D:/forks/firetv', 't-fork')];
    expect(groupSessions(FIRETV_CLIS, twins).ungrouped).toHaveLength(2);
  });

  it('a label naming no known project stays in the tray', () => {
    const s = session({ id: 'y', cwd: `${WT}\\1`, runLabel: 'fleet-door:app_master:cli-master:nowhere' });
    expect(groupSessions([s], PROJECTS).ungrouped.map((r) => r.id)).toEqual(['y']);
  });
});

describe('a persona\'s dispatched sessions join the bay that persona lives in', () => {
  const homes = personaHomes([
    { id: 'p-master', home_team_id: 't-firetv' },
    { id: 'p-loose', home_team_id: null },
  ]);

  it('moves a worker of the in-app App Master (personaId set) into its persona\'s bay', () => {
    const worker = session({ id: 'w1', cwd: 'C:/wt/abc', runLabel: 'app-master:p-master', personaId: 'p-master' });
    const g = groupSessions([worker], PROJECTS);
    const claimed = claimByPersona(g.byTeam, g.ungrouped, homes, compareSessions);
    expect(claimed.ungrouped).toEqual([]);
    expect(claimed.byTeam.get('t-firetv')!.map((s) => s.id)).toEqual(['w1']);
  });

  it('merges into the bay\'s existing sessions in reading order', () => {
    const g = groupSessions([
      ...FIRETV_CLIS,
      session({ id: 'asks', cwd: 'C:/wt/q', personaId: 'p-master', state: 'awaiting_input', createdAtMs: 1n }),
    ], PROJECTS);
    const claimed = claimByPersona(g.byTeam, g.ungrouped, homes, compareSessions);
    expect(claimed.byTeam.get('t-firetv')!.map((s) => s.id)).toEqual(['asks', 'baff8c62', 'a6c6bdae']);
  });

  it('keeps a session whose persona has no bay, and returns the same objects when nothing moves', () => {
    const g = groupSessions([session({ id: 'z', cwd: 'C:/wt/z', personaId: 'p-loose' })], PROJECTS);
    const claimed = claimByPersona(g.byTeam, g.ungrouped, homes, compareSessions);
    expect(claimed.byTeam).toBe(g.byTeam);
    expect(claimed.ungrouped).toBe(g.ungrouped);
  });
});

describe('the label and slug rules are the /appmaster skill\'s own', () => {
  // The skill owns both rules; reading its source here is what keeps the board from drifting off them.
  const contract = readFileSync(resolve(process.cwd(), '.claude/skills/appmaster/lib/contract.mjs'), 'utf8');
  const worker = readFileSync(resolve(process.cwd(), '.claude/skills/appmaster/lib/worker.mjs'), 'utf8');

  it('stamps cli-master:<slug> on every builder', () => {
    expect(contract).toContain("export const RUN_LABEL_PREFIX = 'cli-master:';");
    expect(worker).toContain('PERSONAS_RUN_LABEL: RUN_LABEL_PREFIX + slug');
  });

  it('slugs a project by its root\'s last segment, with the same slugify', () => {
    expect(contract).toContain("export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');");
    expect(contract).toContain("export const slugOf = (name, root) => slugify(path.basename(String(root || '').replace(/[\\\\/]+$/, '')) || name);");
    expect(slugify('Study Desk (firetv)')).toBe('study-desk-firetv');
  });
});
