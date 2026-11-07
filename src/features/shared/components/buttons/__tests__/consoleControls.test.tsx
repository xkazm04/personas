import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';
import { PressSurface } from '../PressSurface';
import { OptionChip } from '../../forms/OptionChip';
import { OptionRow } from '../../forms/OptionRow';

describe('Button pressed / link / sizes', () => {
  it('sets aria-pressed and the selected look when pressed', () => {
    render(<Button variant="ghost" pressed>On</Button>);
    const b = screen.getByRole('button', { name: 'On' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.className).toContain('bg-sel');
    expect(b.className).toContain('text-ink-1');
  });
  it('pressed=false reports aria-pressed false without the selected look; undefined omits it', () => {
    const { rerender } = render(<Button variant="secondary" pressed={false}>X</Button>);
    const b = screen.getByRole('button', { name: 'X' });
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.className).not.toContain('bg-sel');
    rerender(<Button variant="secondary">X</Button>);
    expect(b.getAttribute('aria-pressed')).toBeNull();
  });
  it('secondary pressed also gets the selected look', () => {
    render(<Button variant="secondary" pressed>S</Button>);
    expect(screen.getByRole('button', { name: 'S' }).className).toContain('bg-sel');
  });
  it('link is an ink link and inline size has no height or padding', () => {
    render(<Button variant="link" size="inline">more</Button>);
    const b = screen.getByRole('button', { name: 'more' });
    expect(b.className).toContain('text-ink-1');
    expect(b.className).not.toContain('text-primary');
    expect(b.className).toContain('hover:underline');
    expect(b.className).toContain('p-0');
    expect(b.className).toContain('h-auto');
  });
  it('icon-xs is a 20px square', () => {
    render(<Button size="icon-xs" aria-label="step" />);
    const b = screen.getByRole('button', { name: 'step' });
    expect(b.className).toContain('w-5');
    expect(b.className).toContain('h-5');
  });
});

describe('OptionChip', () => {
  it('selected, count, click', () => {
    const onSelect = vi.fn();
    render(<OptionChip selected onSelect={onSelect} count={12}>Open</OptionChip>);
    const b = screen.getByRole('button', { name: /Open/ });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.className).toContain('bg-sel');
    expect(screen.getByText('12').className).toContain('num');
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('role passthrough maps to the matching aria attribute', () => {
    render(
      <div>
        <OptionChip role="tab" selected onSelect={() => {}}>A</OptionChip>
        <OptionChip role="radio" selected={false} onSelect={() => {}}>B</OptionChip>
      </div>,
    );
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('radio', { name: 'B' }).getAttribute('aria-checked')).toBe('false');
  });
  it('is keyboard reachable and does not fire when disabled', () => {
    const onSelect = vi.fn();
    render(<OptionChip selected={false} disabled onSelect={onSelect}>Z</OptionChip>);
    const b = screen.getByRole('button', { name: 'Z' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onSelect).not.toHaveBeenCalled();
    expect(b.tagName).toBe('BUTTON');
  });
});

describe('OptionRow', () => {
  it('renders meta, selected look and role option', () => {
    const onSelect = vi.fn();
    render(<OptionRow role="option" selected onSelect={onSelect} meta="3">Row</OptionRow>);
    const b = screen.getByRole('option', { name: /Row/ });
    expect(b.getAttribute('aria-selected')).toBe('true');
    expect(b.className).toContain('bg-sel');
    expect(b.className).toContain('min-h-[var(--row-h)]');
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalled();
  });
  it('unselected row hovers to surface-1', () => {
    render(<OptionRow onSelect={() => {}}>R</OptionRow>);
    expect(screen.getByRole('button', { name: 'R' }).className).toContain('hover:bg-surface-1');
  });
});

describe('PressSurface', () => {
  it('fires onPress, defaults to type button, carries the focus ring', () => {
    const onPress = vi.fn();
    render(<PressSurface onPress={onPress} className="w-full">card</PressSurface>);
    const b = screen.getByRole('button', { name: 'card' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('focus-ring');
    expect(b.className).toContain('w-full');
    fireEvent.click(b);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('disabled blocks the press; selected adds bg-sel', () => {
    const onPress = vi.fn();
    const { rerender } = render(<PressSurface onPress={onPress} disabled>x</PressSurface>);
    fireEvent.click(screen.getByRole('button', { name: 'x' }));
    expect(onPress).not.toHaveBeenCalled();
    rerender(<PressSurface onPress={onPress} selected>x</PressSurface>);
    expect(screen.getByRole('button', { name: 'x' }).className).toContain('bg-sel');
  });
});
