import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Slider, type SliderProps } from '../Slider';

/** Controlled harness so onChange round-trips back into the slider value. */
function Harness({
  initial = 0,
  ...rest
}: { initial?: number } & Omit<SliderProps, 'value' | 'onChange'> & {
  onChange?: (v: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v);
        rest.onChange?.(v);
      }}
    />
  );
}

const slider = () => screen.getByRole('slider') as HTMLInputElement;

describe('Slider', () => {
  it('renders a range input with the current value and aria-label', () => {
    render(<Harness initial={30} min={0} max={100} ariaLabel="Threshold" />);
    expect(slider().value).toBe('30');
    expect(slider().getAttribute('aria-label')).toBe('Threshold');
  });

  it('fires onChange live on every change (the draft)', () => {
    const onChange = vi.fn();
    render(<Harness initial={10} min={0} max={100} onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
    expect(slider().value).toBe('42');
  });

  it('fires onCommit on blur only when the value changed', () => {
    const onCommit = vi.fn();
    render(<Harness initial={10} min={0} max={100} onCommit={onCommit} />);
    fireEvent.focus(slider());
    fireEvent.change(slider(), { target: { value: '55' } });
    fireEvent.blur(slider());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(55);
  });

  it('does not fire onCommit on a focus/blur with no change', () => {
    const onCommit = vi.fn();
    render(<Harness initial={10} min={0} max={100} onCommit={onCommit} />);
    fireEvent.focus(slider());
    fireEvent.blur(slider());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('fires onCommit once on pointer-drag release (window pointerup)', () => {
    const onCommit = vi.fn();
    render(<Harness initial={10} min={0} max={100} onCommit={onCommit} />);
    fireEvent.pointerDown(slider());
    fireEvent.change(slider(), { target: { value: '70' } });
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(70);
  });
});
