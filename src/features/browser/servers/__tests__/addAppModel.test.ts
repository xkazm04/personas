import { describe, expect, it } from 'vitest';

import type { DevProject } from '@/lib/bindings/DevProject';

import { addAppGroups } from '../addAppModel';

const project = (id: string, name: string, workspace_id: string | null, kind = 'code'): DevProject =>
  ({ id, name, root_path: `C:\\dev\\${name}`, workspace_id, kind, tech_stack: null }) as unknown as DevProject;
// INVARIANT: addAppGroups reads only id, name, root_path, workspace_id and kind.

const WS = [
  { id: 'ws-core', name: 'Core', color: '#6366f1' },
  { id: 'ws-lab', name: 'Lab', color: '#10b981' },
];

const PROJECTS = [
  project('p1', 'zeta', 'ws-core'),
  project('p2', 'alpha', 'ws-core'),
  project('p3', 'beta', 'ws-lab'),
  project('p4', 'loose', null),
  project('p5', 'orphan', 'ws-deleted'),
  project('p6', 'registry', 'ws-core', 'registry'),
];

describe('addAppGroups', () => {
  it('groups code projects by workspace, in workspace order, names sorted, no-workspace last', () => {
    const groups = addAppGroups(PROJECTS, WS, new Set(), '');
    expect(groups.map((g) => g.workspace?.id ?? null)).toEqual(['ws-core', 'ws-lab', null]);
    expect(groups[0]!.projects.map((p) => p.name)).toEqual(['alpha', 'zeta']);
    expect(groups[2]!.projects.map((p) => p.name)).toEqual(['loose', 'orphan']);
  });

  it('leaves out projects already in Server control and registry projects', () => {
    const names = addAppGroups(PROJECTS, WS, new Set(['p2', 'p3']), '').flatMap((g) => g.projects.map((p) => p.name));
    expect(names).toEqual(['zeta', 'loose', 'orphan']);
  });

  it('filters on name or path and drops emptied groups', () => {
    const groups = addAppGroups(PROJECTS, WS, new Set(), 'bet');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workspace?.id).toBe('ws-lab');
  });

  it('is empty when everything is already in the view', () => {
    expect(addAppGroups(PROJECTS, WS, new Set(['p1', 'p2', 'p3', 'p4', 'p5']), '')).toEqual([]);
  });
});
