import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { DevTask } from '@/lib/bindings/DevTask';

// "Prepare branch & commit" goes through two IPC calls. invokeWithTimeout
// rejects with a serialised AppError OBJECT, so the failure toast must carry
// its `error` text rather than "[object Object]".

const createBranch = vi.hoisted(() => vi.fn());
const commitChanges = vi.hoisted(() => vi.fn());
const getGitStatus = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useDevToolsActions', () => ({
  useDevToolsActions: () => ({ createBranch, commitChanges, getGitStatus }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      activeProjectId: 'p1',
      projects: [{ id: 'p1', name: 'App', github_url: 'https://github.com/acme/app' }],
      ideas: [],
    }),
}));

import { PrBridge } from '../PrBridge';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['plugins']);
});
beforeEach(() => {
  vi.clearAllMocks();
  getGitStatus.mockResolvedValue({ changedFiles: [] });
});

const task = {
  id: 'task-1234567', title: 'Fix login', description: null, status: 'completed', source_idea_id: null,
} as unknown as DevTask;

describe('PrBridge prepare failure', () => {
  it('toasts the AppError text, not [object Object]', async () => {
    createBranch.mockRejectedValue({ error: "a branch named 'dev-tools/fix-login' already exists", kind: 'git' });
    render(<PrBridge task={task} />);

    fireEvent.click(screen.getByRole('button', { name: /ship as draft pr/i }));
    fireEvent.click(screen.getByRole('button', { name: /prepare branch/i }));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [message, kind] = addToast.mock.calls[0]!;
    expect(kind).toBe('error');
    expect(message).toContain('already exists');
    expect(message).not.toContain('[object Object]');
    expect(commitChanges).not.toHaveBeenCalled();
  });
});

describe('PrBridge prepare soft failure', () => {
  const open = () => {
    render(<PrBridge task={task} />);
    fireEvent.click(screen.getByRole('button', { name: /ship as draft pr/i }));
    fireEvent.click(screen.getByRole('button', { name: /prepare branch/i }));
  };

  it('a failed checkout reports its stderr and never commits', async () => {
    createBranch.mockResolvedValue({ success: false, message: 'fatal: a branch named x already exists' });
    open();
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [message, kind] = addToast.mock.calls[0]!;
    expect(kind).toBe('error');
    expect(message).toContain('already exists');
    expect(commitChanges).not.toHaveBeenCalled();
  });

  it('a failed commit is not toasted as prepared', async () => {
    createBranch.mockResolvedValue({ success: true, message: '' });
    commitChanges.mockResolvedValue({ success: false, message: 'nothing to commit' });
    open();
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [message, kind] = addToast.mock.calls[0]!;
    expect(kind).toBe('error');
    expect(message).toContain('nothing to commit');
  });
});

describe('PrBridge prepare consent', () => {
  it('lists the dirty files and commits nothing until the operator confirms', async () => {
    getGitStatus.mockResolvedValue({ changedFiles: [' M src/a.ts', '?? notes.txt'] });
    createBranch.mockResolvedValue({ success: true });
    commitChanges.mockResolvedValue({ success: true });
    render(<PrBridge task={task} />);

    fireEvent.click(screen.getByRole('button', { name: /ship as draft pr/i }));
    fireEvent.click(screen.getByRole('button', { name: /prepare branch/i }));

    expect(await screen.findByText(/src\/a\.ts/)).toBeTruthy();
    expect(createBranch).not.toHaveBeenCalled();
    expect(commitChanges).not.toHaveBeenCalled();

    // The dialog's confirm button carries the same label; it is the last one in the DOM.
    fireEvent.click(screen.getAllByRole('button', { name: /prepare branch/i }).at(-1)!);
    await waitFor(() => expect(commitChanges).toHaveBeenCalledWith('p1', expect.any(String), true, ['src/a.ts', 'notes.txt']));
  });

  it('cancel leaves the project root untouched', async () => {
    getGitStatus.mockResolvedValue({ changedFiles: [' M src/a.ts'] });
    render(<PrBridge task={task} />);
    fireEvent.click(screen.getByRole('button', { name: /ship as draft pr/i }));
    fireEvent.click(screen.getByRole('button', { name: /prepare branch/i }));
    await screen.findByText(/src\/a\.ts/);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(createBranch).not.toHaveBeenCalled();
    expect(commitChanges).not.toHaveBeenCalled();
  });
});
