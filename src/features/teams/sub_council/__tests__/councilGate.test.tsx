/**
 * The gate, driven the way a person drives it.
 *
 * The three rules under test are the ones a model of the data cannot see: a
 * rejection cannot leave without a written reason, approve takes two presses,
 * and no keystroke anywhere commits anything. The last is asserted by
 * pressing every key the page binds while the gate is open and watching
 * nothing happen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

import { CouncilGate } from '../gate/CouncilGate';

const g = en.council.gate;

function renderGate(over: Partial<React.ComponentProps<typeof CouncilGate>> = {}) {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(
    <CouncilGate
      open
      why={g.open_body}
      standing={null}
      onDecide={onDecide}
      focusNonce={0}
      fixture={false}
      {...over}
    />,
  );
  return onDecide;
}

describe('the open gate', () => {
  it('takes two presses to approve', async () => {
    const onDecide = renderGate();
    const approve = screen.getByTestId('council-gate-approve');
    fireEvent.click(approve);
    // AsyncButton awaits the handler, so the armed label lands a tick later.
    await vi.waitFor(() => expect(approve.textContent).toContain(g.approve_confirm));
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await vi.waitFor(() => expect(onDecide).toHaveBeenCalledWith('approved', null));
  });

  it('will not reject without a written reason, and counts down to it', () => {
    const onDecide = renderGate();
    fireEvent.click(screen.getByTestId('council-gate-reject'));
    const go = screen.getByTestId('council-gate-reject-go');
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByTestId('council-reject-reason'), { target: { value: 'short' } });
    expect(go).toBeDisabled();
    expect(screen.getByTestId('council-reject-need').textContent).toContain('7');
    fireEvent.click(go);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('rejects once the reason is long enough', async () => {
    const onDecide = renderGate();
    fireEvent.click(screen.getByTestId('council-gate-reject'));
    fireEvent.change(screen.getByTestId('council-reject-reason'), {
      target: { value: 'the migration has no down path' },
    });
    const go = screen.getByTestId('council-gate-reject-go');
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    await vi.waitFor(() =>
      expect(onDecide).toHaveBeenCalledWith('rejected', 'the migration has no down path'),
    );
  });

  it('commits on no keystroke at all', () => {
    const onDecide = renderGate();
    for (const key of ['Enter', ' ', 'g', 'G', 'a', 'A', 'r', 'y', 'Escape', '1', 'q']) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyUp(window, { key });
    }
    expect(onDecide).not.toHaveBeenCalled();
  });
});

describe('the closed gate', () => {
  it('says why, once, and offers nothing to press', () => {
    renderGate({ open: false, why: g.why_machine_pass });
    expect(screen.getByTestId('council-gate').dataset.gateOpen).toBe('false');
    expect(screen.queryByTestId('council-gate-approve')).toBeNull();
    expect(screen.queryByTestId('council-gate-reject')).toBeNull();
    expect(screen.getByText(g.why_machine_pass)).toBeTruthy();
  });

  it('shows back the reason that was written', () => {
    renderGate({
      open: false,
      why: g.why_rejected,
      standing: { decision: 'rejected', reason: 'the migration has no down path' },
    });
    expect(screen.getByText('the migration has no down path')).toBeTruthy();
    expect(screen.getByText(g.reason_recorded)).toBeTruthy();
  });
});

describe('the uncalibrated sentence', () => {
  it('is said exactly once in the whole council vocabulary', () => {
    const said = Object.entries(en.council)
      .flatMap(([group, keys]) =>
        Object.entries(keys as Record<string, string>).map(([k, v]) => [`${group}.${k}`, v] as const),
      )
      .filter(([, v]) => typeof v === 'string' && /uncalibrated/i.test(v));
    expect(said.map(([k]) => k)).toEqual(['bench.lede']);
  });
});
