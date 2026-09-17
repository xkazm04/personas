/**
 * The Sweep control can now schedule the sweep it runs.
 *
 * `health_ingest` has been a live system op with a working handler for two
 * phases, and Context Map's "Plan update" has been the UX precedent, but the
 * control that runs the sweep offered no way to schedule it. The assertions
 * pin the two halves of that: the plan creates a `health_ingest` automation for
 * THIS project, and it does not cost the operator the manual button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const invokeWithTimeout = vi.fn();
const runFindingSweep = vi.fn();
const addToast = vi.fn();

/* The IPC boundary is the mock, NOT `@/api/systemOps`. `planWeeklyHealthIngest`
   calls `createSystemOpAutomation` through a module-local binding, so replacing
   the export would leave the real one running and the test would assert on a
   spy nothing calls. Mocking one layer lower also makes the assertion stronger:
   it pins the command name and the exact payload that reaches Rust. */
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

vi.mock('../sweep', () => ({ runFindingSweep: (...a: unknown[]) => runFindingSweep(...a) }));

// `toastCatch` reads the store imperatively, the component through a selector.
// Both doors must exist or the failure path throws instead of reporting.
const toastState = { addToast };
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(toastState),
    { getState: () => toastState },
  ),
}));

const project = { id: 'p1', name: 'personas', root_path: 'C:/repo' };
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ projects: [project], ideas: [], tasks: [] }),
}));

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ credentials: [] }),
}));

vi.mock('../usePassportForProject', () => ({ usePassportForProject: () => null }));

import { SweepButton } from '../SweepButton';
import { OP_HEALTH_INGEST, WEEKLY_HEALTH_INGEST_CRON } from '@/api/systemOps';

/** The one `system_ops_create_automation` call this click produced. */
function created(): { opKind: string; paramsJson: string; triggerKind: string; cron: string } {
  const call = invokeWithTimeout.mock.calls.find((c) => c[0] === 'system_ops_create_automation');
  if (!call) throw new Error('no automation was created');
  return call[1] as { opKind: string; paramsJson: string; triggerKind: string; cron: string };
}

describe('SweepButton — plan weekly', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({ id: 'auto-1' });
    runFindingSweep.mockReset();
    addToast.mockReset();
  });

  it('creates ONE weekly health_ingest automation scoped to this project', async () => {
    render(<SweepButton projectId="p1" onSwept={() => {}} />);

    fireEvent.click(screen.getByTestId('findings-sweep-plan'));

    await waitFor(() => expect(invokeWithTimeout).toHaveBeenCalled());
    const arg = created();
    expect(arg.opKind).toBe(OP_HEALTH_INGEST);
    expect(arg.triggerKind).toBe('schedule');
    expect(arg.cron).toBe(WEEKLY_HEALTH_INGEST_CRON);
    // The op requires a projectId; an automation without one would fail in Rust
    // at fire time rather than here, which is the worst place to learn it.
    expect(JSON.parse(arg.paramsJson)).toEqual({ projectId: 'p1' });
  });

  it('the manual sweep still works after planning one', async () => {
    runFindingSweep.mockResolvedValue({
      created: 0, duplicates: 0, dropped: 0, skippedSensors: [], errors: [],
      verified: { cleared: 0, moved: 0, unchanged: 0, regressed: 0, unverifiable: 0 },
    });
    render(<SweepButton projectId="p1" onSwept={() => {}} />);

    fireEvent.click(screen.getByTestId('findings-sweep-plan'));
    await waitFor(() => expect(invokeWithTimeout).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('findings-sweep'));
    await waitFor(() => expect(runFindingSweep).toHaveBeenCalledTimes(1));
  });

  it('a failed plan is reported, not swallowed', async () => {
    invokeWithTimeout.mockRejectedValue(new Error('no scheduler'));
    render(<SweepButton projectId="p1" onSwept={() => {}} />);

    fireEvent.click(screen.getByTestId('findings-sweep-plan'));
    // The button must come back out of its busy state rather than latching on a
    // failure the operator was never told about.
    await waitFor(() => expect(screen.getByTestId('findings-sweep-plan')).not.toHaveAttribute('aria-busy', 'true'));
    expect(invokeWithTimeout).toHaveBeenCalled();
  });

  it('both controls are inert without a project', () => {
    render(<SweepButton projectId={null} onSwept={() => {}} />);
    expect(screen.getByTestId('findings-sweep-plan')).toBeDisabled();
    expect(screen.getByTestId('findings-sweep')).toBeDisabled();
  });
});
