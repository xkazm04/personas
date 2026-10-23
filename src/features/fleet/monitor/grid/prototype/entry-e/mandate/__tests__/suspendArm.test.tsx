// Suspend arms on the first press and acts on the second; Escape stands it
// down; Resume acts at once. The drawer shell spans the Monitor when `fill`.

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { MonitorDrawerShell } from '../../../../../MonitorDrawerShell';
import { useSuspendArm } from '../MandateHead';

const wrapper = ({ children }: { children: ReactNode }) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;

describe('useSuspendArm', () => {
  it('arms first, suspends on the second press', async () => {
    const write = vi.fn(async () => {});
    const { result } = renderHook(() => useSuspendArm(false, write), { wrapper });
    await act(() => result.current.press());
    expect(result.current.armed).toBe(true);
    expect(write).not.toHaveBeenCalled();
    await act(() => result.current.press());
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it('Escape disarms without writing', async () => {
    const write = vi.fn(async () => {});
    const { result } = renderHook(() => useSuspendArm(false, write), { wrapper });
    await act(() => result.current.press());
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(result.current.armed).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('resumes on one press', async () => {
    const write = vi.fn(async () => {});
    const { result } = renderHook(() => useSuspendArm(true, write), { wrapper });
    await act(() => result.current.press());
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('MonitorDrawerShell', () => {
  it('spans the Monitor only when asked to fill', () => {
    const { container, rerender } = render(<MonitorDrawerShell open onClose={() => {}}><p>x</p></MonitorDrawerShell>);
    expect(container.querySelector('[data-fill]')).toBeNull();
    rerender(<MonitorDrawerShell open fill onClose={() => {}}><p>x</p></MonitorDrawerShell>);
    expect(container.querySelector('[data-fill]')?.className).toContain('bottom-0');
  });
});
