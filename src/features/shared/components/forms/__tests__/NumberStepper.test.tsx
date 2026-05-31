import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { common: { increase: 'Increase', decrease: 'Decrease' } },
    tx: (s: string) => s,
  }),
}));

import { NumberStepper, type NumberStepperProps } from '../NumberStepper';

/** Controlled harness so we can assert what the stepper emits over time. */
function Harness({
  initial = null,
  ...rest
}: { initial?: number | null } & Omit<NumberStepperProps, 'value' | 'onChange'> & {
  onChange?: (v: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberStepper
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v);
        rest.onChange?.(v);
      }}
    />
  );
}

const inc = () => screen.getByRole('button', { name: 'Increase' });
const dec = () => screen.getByRole('button', { name: 'Decrease' });
const field = () => screen.getByRole('spinbutton') as HTMLInputElement;

describe('NumberStepper', () => {
  it('renders the current value and exposes spinbutton a11y attributes', () => {
    render(<Harness initial={5} min={1} max={50} ariaLabel="Threshold" />);
    expect(field().value).toBe('5');
    expect(field().getAttribute('aria-valuenow')).toBe('5');
    expect(field().getAttribute('aria-valuemin')).toBe('1');
    expect(field().getAttribute('aria-valuemax')).toBe('50');
  });

  it('steps up and down by the step on button press', () => {
    render(<Harness initial={10} step={5} />);
    fireEvent.pointerDown(inc());
    fireEvent.pointerUp(inc());
    expect(field().value).toBe('15');
    fireEvent.pointerDown(dec());
    fireEvent.pointerUp(dec());
    expect(field().value).toBe('10');
  });

  it('clamps to max and disables the increase button at the ceiling', () => {
    render(<Harness initial={50} min={1} max={50} />);
    expect((inc() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.pointerDown(inc());
    expect(field().value).toBe('50');
  });

  it('clamps to min and disables the decrease button at the floor', () => {
    render(<Harness initial={1} min={1} max={50} />);
    expect((dec() as HTMLButtonElement).disabled).toBe(true);
  });

  it('rounds to the step precision (no float drift)', () => {
    render(<Harness initial={0.1} step={0.01} min={0} />);
    fireEvent.pointerDown(inc());
    fireEvent.pointerUp(inc());
    expect(field().value).toBe('0.11');
  });

  it('seeds from defaultValue when stepping out of an empty field', () => {
    render(<Harness initial={null} step={1} defaultValue={30} allowEmpty min={1} max={300} />);
    expect(field().value).toBe('');
    fireEvent.pointerDown(inc());
    fireEvent.pointerUp(inc());
    expect(field().value).toBe('30');
  });

  it('allows clearing to null when allowEmpty is set', () => {
    const onChange = vi.fn();
    render(<Harness initial={12} allowEmpty onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clamps typed-then-blurred values into range', () => {
    render(<Harness initial={10} min={1} max={50} />);
    fireEvent.change(field(), { target: { value: '999' } });
    fireEvent.blur(field());
    expect(field().value).toBe('50');
  });

  it('steps via ArrowUp / ArrowDown keys', () => {
    render(<Harness initial={10} step={2} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().value).toBe('12');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().value).toBe('10');
  });

  it('fires onCommit on blur only when the value changed, with the clamped value', () => {
    const onCommit = vi.fn();
    render(<Harness initial={10} min={1} max={50} onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '999' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(50);
  });

  it('does not fire onCommit on a focus/blur that leaves the value unchanged', () => {
    const onCommit = vi.fn();
    render(<Harness initial={10} min={1} max={50} onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('fires onCommit once on button release, not per accelerating tick', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Harness initial={10} step={5} onChange={onChange} onCommit={onCommit} />);
    fireEvent.pointerDown(inc());
    fireEvent.pointerUp(inc());
    expect(onChange).toHaveBeenCalled();           // live draft fired
    expect(onCommit).toHaveBeenCalledTimes(1);     // settle fired exactly once
    expect(onCommit).toHaveBeenLastCalledWith(15);
  });
});
