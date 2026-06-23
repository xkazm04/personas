import { describe, it, expect, beforeEach } from 'vitest';
import { useImproveActivityStore, selectAnyImproveRunning } from './improveActivityStore';

const reset = () => useImproveActivityStore.setState({ byCell: {}, byRun: {} });
const get = () => useImproveActivityStore.getState();

describe('improveActivityStore', () => {
  beforeEach(reset);

  it('marks a cell busy on start and exposes it both ways', () => {
    get().start('proj-a:tests', 'task-1', 'deploy');
    expect(selectAnyImproveRunning(get())).toBe(true);
    expect(get().byCell['proj-a:tests']).toEqual({ runId: 'task-1', kind: 'deploy' });
    expect(get().byRun['task-1']).toBe('proj-a:tests');
  });

  it('clears the right cell on endByRun and goes idle', () => {
    get().start('proj-a:tests', 'task-1', 'deploy');
    get().endByRun('task-1');
    expect(get().byCell['proj-a:tests']).toBeUndefined();
    expect(get().byRun['task-1']).toBeUndefined();
    expect(selectAnyImproveRunning(get())).toBe(false);
  });

  it('ignores endByRun for an untracked run id', () => {
    get().start('proj-a:tests', 'task-1', 'deploy');
    get().endByRun('nope');
    expect(selectAnyImproveRunning(get())).toBe(true);
    expect(get().byCell['proj-a:tests']).toBeDefined();
  });

  it('superseding the same cell drops the stale run so a late completion cannot clear the new op', () => {
    get().start('proj-a:context', 'scan-1', 'scan');
    get().start('proj-a:context', 'scan-2', 'scan'); // re-fired same cell
    expect(get().byRun['scan-1']).toBeUndefined();    // stale reverse entry gone
    expect(get().byRun['scan-2']).toBe('proj-a:context');

    get().endByRun('scan-1');                         // late terminal for the superseded run
    expect(get().byCell['proj-a:context']).toEqual({ runId: 'scan-2', kind: 'scan' }); // new op intact
    expect(selectAnyImproveRunning(get())).toBe(true);
  });

  it('tracks multiple cells independently', () => {
    get().start('proj-a:tests', 'task-1', 'deploy');
    get().start('proj-b:context', 'scan-9', 'scan');
    get().endByRun('task-1');
    expect(get().byCell['proj-a:tests']).toBeUndefined();
    expect(get().byCell['proj-b:context']).toBeDefined(); // sibling unaffected
    expect(selectAnyImproveRunning(get())).toBe(true);
  });
});
