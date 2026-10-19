import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { DevTask } from '@/lib/bindings/DevTask';

// "Prepare branch & commit" goes through two IPC calls. invokeWithTimeout
// rejects with a serialised AppError OBJECT, so the failure toast must carry
// its `error` text rather than "[object Object]".

const createBranch = vi.hoisted(() => vi.fn());
const commitChanges = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useDevToolsActions', () => ({
  useDevToolsActions: () => ({ createBranch, commitChanges }),
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
beforeEach(() => vi.clearAllMocks());

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
