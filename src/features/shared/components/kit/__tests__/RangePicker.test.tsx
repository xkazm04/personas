/** RangePicker: presets select, a custom range lights Custom, Custom opens the caller's picking. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RangePicker } from '../index';

const presets = [{ v: 1, label: '24h' }, { v: 7, label: '7d' }, { v: 30, label: '30d' }];

describe('RangePicker', () => {
  it('marks the active preset pressed and reports a pick', () => {
    const onChange = vi.fn();
    render(<RangePicker label="Time range" presets={presets} value={7} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '7d' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '24h' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('opens and closes the custom picking, and an applied custom range un-presses the presets', () => {
    const picking = (close: () => void) => <button type="button" onClick={close}>apply</button>;
    const { rerender } = render(
      <RangePicker label="Time range" presets={presets} value={7} onChange={() => {}} custom={{ label: 'Custom', active: false, render: picking }} />,
    );
    const custom = screen.getByRole('button', { name: 'Custom' });
    expect(screen.queryByText('apply')).toBeNull();
    fireEvent.click(custom);
    expect(custom.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('apply'));
    expect(screen.queryByText('apply')).toBeNull();
    fireEvent.click(custom);
    expect(screen.getByText('apply')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('apply')).toBeNull();
    fireEvent.click(custom);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('apply')).toBeNull();
    rerender(
      <RangePicker label="Time range" presets={presets} value={7} onChange={() => {}} custom={{ label: 'Sep 1 - Sep 9', active: true, render: () => null }} />,
    );
    expect(screen.getByRole('button', { name: '7d' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sep 1 - Sep 9' }).getAttribute('aria-pressed')).toBe('true');
  });
});
