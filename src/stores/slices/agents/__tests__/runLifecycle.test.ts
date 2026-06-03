import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRunLifecycle } from '../runLifecycle';

/**
 * Unit tests for the run-lifecycle FSM wrapper, focused on the recovery path
 * (markRecovered) that fixes the phantom-isExecuting lock after a page refresh.
 *
 * The lifecycle keeps `currentState` in a module closure. A run recovered from
 * persisted state seeds isRunning=true in the slice WITHOUT calling markStarted,
 * so the FSM would otherwise stay at 'idle' and reject the later
 * 'finished'/'cancelled' transition — pinning isRunning true forever.
 */
describe('createRunLifecycle — recovery path', () => {
  /** Collect the partials passed to set() so assertions can read the last write. */
  function makeSet() {
    const calls: Record<string, unknown>[] = [];
    const set = (partial: Record<string, unknown>) => { calls.push(partial); };
    return { set, calls };
  }

  it('without markRecovered, markFinished from idle is rejected (the bug it guards against)', () => {
    const lifecycle = createRunLifecycle('isRunning', 'progress');
    const { set, calls } = makeSet();

    // Simulate a recovered run: isRunning is true in the slice, but the FSM
    // closure is still 'idle' because markStarted was never called.
    lifecycle.markFinished(set);

    // Transition rejected → set never fired → isRunning would stay true.
    expect(calls).toHaveLength(0);
  });

  it('markRecovered seeds running so markFinished then clears isRunning', () => {
    const lifecycle = createRunLifecycle('isRunning', 'progress');
    const { set, calls } = makeSet();

    lifecycle.markRecovered(set);
    lifecycle.markFinished(set);

    expect(calls).toContainEqual({ isRunning: false });
  });

  it('markRecovered seeds running so markCancelled then clears isRunning + progress', () => {
    const lifecycle = createRunLifecycle('isRunning', 'progress');
    const { set, calls } = makeSet();

    lifecycle.markRecovered(set);
    lifecycle.markCancelled(set);

    expect(calls).toContainEqual({ isRunning: false, progress: null });
  });

  it('after markRecovered → markFinished, a fresh markStarted works (running again)', () => {
    const lifecycle = createRunLifecycle('isRunning', 'progress');
    const { set, calls } = makeSet();

    lifecycle.markRecovered(set);
    lifecycle.markFinished(set);
    lifecycle.markStarted(set);

    // markStarted sets isRunning:true — proves the FSM is back in a startable state.
    expect(calls).toContainEqual({ isRunning: true, progress: null, error: null });
  });

  describe('safety timeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('markRecovered re-arms the 30-minute safety timeout that clears a stalled run', () => {
      const lifecycle = createRunLifecycle('isRunning', 'progress');
      const { set, calls } = makeSet();

      lifecycle.markRecovered(set);
      expect(calls).toHaveLength(0); // nothing set synchronously

      vi.advanceTimersByTime(30 * 60 * 1000);

      const last = calls.at(-1);
      expect(last?.isRunning).toBe(false);
      expect(last?.progress).toBeNull();
      expect(typeof last?.error).toBe('string');
    });

    it('markFinished clears the recovery safety timeout (no late reset fires)', () => {
      const lifecycle = createRunLifecycle('isRunning', 'progress');
      const { set, calls } = makeSet();

      lifecycle.markRecovered(set);
      lifecycle.markFinished(set);
      const countAfterFinish = calls.length;

      vi.advanceTimersByTime(30 * 60 * 1000);

      // Timeout was cleared by markFinished → no additional set() call.
      expect(calls).toHaveLength(countAfterFinish);
    });
  });
});
