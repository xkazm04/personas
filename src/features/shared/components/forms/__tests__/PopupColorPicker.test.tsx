import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PopupColorPicker } from '../PopupColorPicker';

describe('PopupColorPicker', () => {
  it('names its trigger without relying on the native title, and exposes open state', () => {
    render(<PopupColorPicker value="#10b981" onChange={vi.fn()} />);
    const trigger = document.querySelector('button[aria-haspopup]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBeTruthy();
    expect(trigger!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger!);
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThan(0);
  });
});
