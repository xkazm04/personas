/**
 * Unit tests for FleetSpawnTaskModal's busy state.
 *
 * Spawning is an ACTION the operator just pressed, so the repo's spinner
 * boundary requires the control itself to show a real spinner plus aria-busy —
 * a swapped label alone is indistinguishable from a click that never
 * registered, which on a multi-second `claude` spawn is exactly when it
 * matters. These tests pin the busy contract and the double-submit guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FleetSpawnTaskModal } from '../FleetSpawnTaskModal';

/** A spawn that never settles, so the in-flight state can be observed. */
function pendingSpawn() {
  let release: (ok: boolean) => void = () => {};
  const onSpawn = vi.fn(
    () => new Promise<boolean>((resolve) => {
      release = resolve;
    }),
  );
  return { onSpawn, release: (ok: boolean) => release(ok) };
}

describe('FleetSpawnTaskModal — busy state', () => {
  it('marks the submit control busy (spinner + aria-busy) while the spawn is in flight', async () => {
    const user = userEvent.setup();
    const { onSpawn, release } = pendingSpawn();

    render(
      <FleetSpawnTaskModal open onClose={() => {}} projectPath="C:/repo" onSpawn={onSpawn} />,
    );

    const submit = screen.getByTestId('fleet-spawn-task-submit');
    expect(submit).not.toHaveAttribute('aria-busy');

    await user.type(screen.getByTestId('fleet-spawn-task-text'), 'do the thing');
    await user.click(submit);

    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    // A busy control is a disabled control — this is the double-submit guard.
    expect(submit).toBeDisabled();
    // Button renders its spinner as an animated element inside the control.
    expect(submit.querySelector('.animate-spin')).not.toBeNull();

    release(true);
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy'));
  });

  it('does not fire a second spawn while the first is in flight', async () => {
    const user = userEvent.setup();
    const { onSpawn, release } = pendingSpawn();

    render(
      <FleetSpawnTaskModal open onClose={() => {}} projectPath="C:/repo" onSpawn={onSpawn} />,
    );
    const submit = screen.getByTestId('fleet-spawn-task-submit');
    await user.type(screen.getByTestId('fleet-spawn-task-text'), 'once');
    await user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);

    expect(onSpawn).toHaveBeenCalledTimes(1);
    release(true);
  });

  it('stays disabled with an empty prompt', () => {
    render(
      <FleetSpawnTaskModal open onClose={() => {}} projectPath="C:/repo" onSpawn={vi.fn()} />,
    );
    expect(screen.getByTestId('fleet-spawn-task-submit')).toBeDisabled();
  });
});
