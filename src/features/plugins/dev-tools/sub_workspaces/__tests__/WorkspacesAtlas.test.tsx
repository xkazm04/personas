import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Opening a crest must ENTER the workspace, not just unfold a local detail
// band: the footer breadcrumb and every scoped list read `activeId` from the
// workspace store.

const setActiveProject = vi.fn();

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      projects: [
        { id: 'p1', name: 'Alpha', workspace_id: 'w1' },
        { id: 'p2', name: 'Beta', workspace_id: 'w2' },
      ],
      activeProjectId: null,
      setActiveProject,
      fetchProjects: vi.fn(),
    }),
}));

vi.mock('@/api/devTools/devTools', () => ({
  listProjects: vi.fn(async () => [
    { id: 'p1', name: 'Alpha', workspace_id: 'w1' },
    { id: 'p2', name: 'Beta', workspace_id: 'w2' },
  ]),
  installSystemSkill: vi.fn(async () => undefined),
}));

vi.mock('@/api/devTools/workspaces', () => ({
  listWorkspaces: vi.fn(async () => [
    { id: 'w1', name: 'Northwind', color: '#6366f1', adopt_default_skills: false },
    { id: 'w2', name: 'Southgate', color: '#06b6d4', adopt_default_skills: false },
  ]),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  assignProjectToWorkspace: vi.fn(),
  importLocalWorkspaces: vi.fn(),
}));

vi.mock('../registry/WorkspaceRegistrySection', () => ({
  WorkspaceRegistrySection: () => null,
}));

import WorkspacesAtlas from '../WorkspacesAtlas';
import { workspacesSnapshot } from '../workspaceStore';

beforeEach(() => {
  setActiveProject.mockClear();
  localStorage.clear();
});

describe('WorkspacesAtlas crest selection', () => {
  it('switches the active workspace when a crest is opened', async () => {
    render(<WorkspacesAtlas />);
    const crest = await screen.findByText('Southgate');

    fireEvent.click(crest);

    await waitFor(() => expect(workspacesSnapshot().activeId).toBe('w2'));
    // Re-pointing the active project into the new membership is the whole
    // reason the switch goes through useWorkspaceSwitch.
    expect(setActiveProject).toHaveBeenCalledWith('p2');
  });

  it('keeps the selection when the crest is collapsed again', async () => {
    render(<WorkspacesAtlas />);
    const crest = await screen.findByText('Northwind');

    fireEvent.click(crest);
    await waitFor(() => expect(workspacesSnapshot().activeId).toBe('w1'));

    fireEvent.click(crest);
    expect(workspacesSnapshot().activeId).toBe('w1');
  });
});
