import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemEventCommitModal } from '../SystemEventCommitModal';

const { fetchProjects } = vi.hoisted(() => ({ fetchProjects: vi.fn() }));

vi.mock('@/stores/systemStore', async () => {
  const { create } = await import('zustand');
  interface ProjectStore {
    projects: { id: string; name: string }[];
    activeProjectId: string | null;
    projectsLoading: boolean;
    fetchProjects: () => Promise<void>;
  }
  const useSystemStore = create<ProjectStore>((set) => ({
    projects: [], activeProjectId: null, projectsLoading: false,
    fetchProjects: async () => {
      fetchProjects();
      set({ projectsLoading: true });
      await Promise.resolve();
      set({ projects: [{ id: 'project-1', name: 'Existing project' }], projectsLoading: false });
    },
  }));
  return { useSystemStore };
});
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (select: (state: { personas: never[] }) => unknown) => select({ personas: [] }),
}));
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (select: (state: { teams: never[]; fetchTeams: () => Promise<void> }) => unknown) => select({ teams: [], fetchTeams: async () => {} }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (select: (state: { addToast: () => void }) => unknown) => select({ addToast: vi.fn() }),
}));
vi.mock('@/lib/ui/BaseModal', () => ({
  BaseModal: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/i18n/useTranslation', async () => {
  const { default: t } = await import('@/i18n/locales/en.json');
  return { useTranslation: () => ({ t }) };
});

describe('SystemEventCommitModal', () => {
  it('loads projects on a cold open and selects one for creation', async () => {
    render(<SystemEventCommitModal open onClose={vi.fn()} opKind="context_scan" triggerType="schedule" onCreated={vi.fn()} />);
    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Existing project')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeEnabled();
  });
});
