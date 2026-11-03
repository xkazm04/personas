// @vitest-environment node
// `batchCreateTasks` backs the Run Desk "From accepted" button. It used to call
// `dev_tools_batch_create_tasks`, a command that was never implemented (it sits
// in commandNames.overrides.ts), through `safeInvoke`, whose fallback fires on
// exactly that "command not found" error: the button resolved with [] and
// created nothing. The real per-task door is `dev_tools_create_task`.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<[string, Record<string, unknown> | undefined]> = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (cmd === 'dev_tools_create_task') {
      return Promise.resolve({ id: `task-${calls.length}`, title: args?.title });
    }
    // Tauri's real rejection for an unregistered command.
    return Promise.reject(`Command ${cmd} not found`);
  }),
}));

import { batchCreateTasks } from '@/api/devTools/devTools';

describe('batchCreateTasks', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('creates one task per entry through dev_tools_create_task, in order', async () => {
    const created = await batchCreateTasks(
      [
        { title: 'First', description: 'd1', sourceIdeaId: 'idea-1' },
        { title: 'Second', sourceIdeaId: 'idea-2', goalId: 'goal-2' },
      ],
      'proj-1',
    );
    expect(created).toHaveLength(2);
    const creates = calls.filter(([cmd]) => cmd === 'dev_tools_create_task');
    expect(creates).toHaveLength(2);
    expect(creates[0]![1]).toMatchObject({ title: 'First', projectId: 'proj-1', description: 'd1', sourceIdeaId: 'idea-1' });
    expect(creates[1]![1]).toMatchObject({ title: 'Second', projectId: 'proj-1', sourceIdeaId: 'idea-2', goalId: 'goal-2' });
  });

  it('surfaces a real failure instead of resolving an empty batch', async () => {
    const { invokeWithTimeout } = await import('@/lib/tauriInvoke');
    vi.mocked(invokeWithTimeout).mockImplementationOnce(() => Promise.reject('project not found'));
    await expect(batchCreateTasks([{ title: 'X' }], 'missing')).rejects.toBe('project not found');
  });
});
