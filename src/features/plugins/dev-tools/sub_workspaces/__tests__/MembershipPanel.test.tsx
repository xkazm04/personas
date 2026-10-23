import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { DevProject } from '@/lib/bindings/DevProject';

// The candidate list dims a project that already lives in another workspace.
// It read `DevProject.workspace_id` from systemStore, a snapshot no workspace
// move refreshes, so the hint went stale on the first move. The workspace
// store is the source every move updates.

vi.mock('../workspaceStore', () => ({
  assignProject: vi.fn(),
  createWorkspace: vi.fn(),
  useWorkspaces: () => ({
    activeId: null,
    workspaces: [
      { id: 'w1', name: 'Northwind', color: '#6366f1', projectIds: [], adoptDefaultSkills: false },
      // p2 was just moved here; systemStore still says it is unassigned.
      { id: 'w2', name: 'Southgate', color: '#06b6d4', projectIds: ['p2'], adoptDefaultSkills: false },
    ],
  }),
}));

import { MembershipPanel } from '../centerShared';

const project = (id: string, name: string, workspace_id: string | null) =>
  ({ id, name, workspace_id, tech_stack: null, kind: 'code' }) as unknown as DevProject;

describe('MembershipPanel candidate hint', () => {
  it('dims by the workspace store, not the stale project snapshot', () => {
    render(
      <MembershipPanel
        workspace={{ id: 'w1', name: 'Northwind', color: '#6366f1', projectIds: [], adoptDefaultSkills: false }}
        projects={[
          project('p1', 'Alpha', 'w2'), // stale: moved out of w2 already
          project('p2', 'Beta', null), // stale: moved into w2 already
        ]}
      />,
    );

    const row = (name: string) => screen.getByText(name).parentElement!;
    expect(row('Alpha').className).not.toContain('opacity-70');
    expect(row('Beta').className).toContain('opacity-70');
  });
});
