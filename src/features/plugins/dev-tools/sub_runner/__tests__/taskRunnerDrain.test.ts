import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/devTools/devTools', () => ({ tasksPage: vi.fn() }));

import { endTaskRunnerIfDrained } from '../useTaskQueue';

// The Run Desk's activity-dock row ("Run Desk Batch" / "Auto-Run") ends when
// no task is running anywhere — asked of the backend, with the status of the
// transition that drained the queue.

describe('endTaskRunnerIfDrained', () => {
  it('ends the activity as failed when the last running task fails', async () => {
    const processEnded = vi.fn();
    const ended = await endTaskRunnerIfDrained('failed', async () => 0, processEnded);
    expect(ended).toBe(true);
    expect(processEnded).toHaveBeenCalledWith('task_runner', 'failed');
  });

  it('ends the activity as cancelled after a cancel drains the queue', async () => {
    const processEnded = vi.fn();
    await endTaskRunnerIfDrained('cancelled', async () => 0, processEnded);
    expect(processEnded).toHaveBeenCalledWith('task_runner', 'cancelled');
  });

  it('keeps the activity while the backend still counts a running task', async () => {
    // The desk may be filtered to `failed`, so the loaded window holds no
    // running row even though one is running: only the backend count decides.
    const processEnded = vi.fn();
    const ended = await endTaskRunnerIfDrained('completed', async () => 1, processEnded);
    expect(ended).toBe(false);
    expect(processEnded).not.toHaveBeenCalled();
  });
});
