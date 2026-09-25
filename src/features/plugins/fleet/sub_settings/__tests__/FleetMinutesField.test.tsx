import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetMinutesField } from '../FleetMinutesField';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { common: { decrease: 'Decrease', increase: 'Increase' } } }),
}));

// Every store write behind this field is also an IPC push to the Rust ticker
// (fleet_set_auto_hibernate / fleet_set_state_cutoffs). The bare number input
// it replaced wrote on every keystroke, so typing "45" pushed "4" and then
// "45". The field must hand the store a settled value exactly once.
describe('FleetMinutesField', () => {
  it('commits a typed value once, on blur, not once per keystroke', () => {
    const onCommit = vi.fn();
    render(<FleetMinutesField label="After" unit="min" value={30} min={1} max={1440} onCommit={onCommit} testId="f" />);
    const input = screen.getByRole('spinbutton');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.change(input, { target: { value: '45' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: '45' } });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(45);
  });

  it('does not commit when focus leaves without a change', () => {
    const onCommit = vi.fn();
    render(<FleetMinutesField label="After" unit="min" value={30} min={1} max={1440} onCommit={onCommit} testId="f" />);
    const input = screen.getByRole('spinbutton');
    fireEvent.focus(input);
    fireEvent.blur(input, { target: { value: '30' } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps the tour anchor on its wrapper', () => {
    render(<FleetMinutesField label="After" unit="min" value={30} min={1} max={60} onCommit={() => {}} testId="fleet-stale-minutes" />);
    expect(screen.getByTestId('fleet-stale-minutes')).toContainElement(screen.getByRole('spinbutton'));
  });
});
