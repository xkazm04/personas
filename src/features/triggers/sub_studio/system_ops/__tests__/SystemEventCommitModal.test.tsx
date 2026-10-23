import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemEventCommitModal } from '../SystemEventCommitModal';

const { fetchProjects, previewCronSchedule, createSystemOpAutomation } = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  previewCronSchedule: vi.fn(),
  createSystemOpAutomation: vi.fn(),
}));

vi.mock('@/api/pipeline/triggers', () => ({
  previewCronSchedule: (...a: unknown[]) => previewCronSchedule(...a),
}));
vi.mock('@/api/systemOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/systemOps')>()),
  createSystemOpAutomation: (...a: unknown[]) => createSystemOpAutomation(...a),
}));

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

describe('SystemEventCommitModal custom cron', () => {
  function openCustom(onCreated = vi.fn()) {
    render(<SystemEventCommitModal open onClose={vi.fn()} opKind="signal_dispatch_runner" triggerType="schedule" onCreated={onCreated} />);
    const cadence = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(cadence, { target: { value: 'custom' } });
    fireEvent.change(screen.getByPlaceholderText('0 3 * * 1'), { target: { value: '0 0 30 2 *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    return onCreated;
  }

  it('refuses a custom cron that can never fire, inside the modal', async () => {
    // Parses, but has no upcoming fire (30 February): the backend would store
    // it with next_run_at NULL and never run it.
    previewCronSchedule.mockResolvedValue({ valid: true, description: '', next_runs: [], error: null });
    const onCreated = openCustom();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid cron expression.'));
    expect(createSystemOpAutomation).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows a refused create inside the modal with the backend reason', async () => {
    previewCronSchedule.mockResolvedValue({ valid: true, description: '', next_runs: ['2026-10-20T03:00:00Z'], error: null });
    createSystemOpAutomation.mockRejectedValue({ error: 'Unknown system op kind: nope', kind: 'validation' });
    openCustom();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unknown system op kind'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('[object Object]');
  });
});
