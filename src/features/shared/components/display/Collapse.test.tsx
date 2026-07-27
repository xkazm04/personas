import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Collapse } from './Collapse';

/**
 * The unmount semantics here are load-bearing: 81 of the 86 height-collapse
 * sites being migrated onto this component came from
 * `<AnimatePresence>{open && …}</AnimatePresence>`, which unmounts its subtree.
 * If `unmountWhenClosed` regressed to "always mounted", every closed section in
 * the app would keep its effects and subscriptions alive.
 */
describe('Collapse', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps children mounted when closed by default (back-compat)', () => {
    render(<Collapse open={false}>content</Collapse>);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('does not render children when closed with unmountWhenClosed', () => {
    render(<Collapse open={false} unmountWhenClosed>content</Collapse>);
    expect(screen.queryByText('content')).toBeNull();
  });

  it('mounts children immediately on open', () => {
    const { rerender } = render(<Collapse open={false} unmountWhenClosed>content</Collapse>);
    expect(screen.queryByText('content')).toBeNull();
    rerender(<Collapse open unmountWhenClosed>content</Collapse>);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('keeps children mounted through the close transition, then unmounts', () => {
    const { rerender } = render(<Collapse open unmountWhenClosed duration={200}>content</Collapse>);
    rerender(<Collapse open={false} unmountWhenClosed duration={200}>content</Collapse>);

    // Still present mid-transition — otherwise the box empties before it shrinks.
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByText('content')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByText('content')).toBeNull();
  });

  it('cancels the pending unmount if reopened mid-close', () => {
    const { rerender } = render(<Collapse open unmountWhenClosed duration={200}>content</Collapse>);
    rerender(<Collapse open={false} unmountWhenClosed duration={200}>content</Collapse>);
    act(() => { vi.advanceTimersByTime(100); });
    rerender(<Collapse open unmountWhenClosed duration={200}>content</Collapse>);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('drives the grid rows between 0fr and 1fr', () => {
    const { container, rerender } = render(<Collapse open={false}>content</Collapse>);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.gridTemplateRows).toBe('0fr');
    rerender(<Collapse open>content</Collapse>);
    expect(outer.style.gridTemplateRows).toBe('1fr');
  });

  it('keeps overflow hidden while opening and reveals it only once settled', () => {
    const { container, rerender } = render(
      <Collapse open={false} revealOverflowWhenOpen duration={200}>content</Collapse>,
    );
    const inner = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(inner.style.overflow).toBe('hidden');

    rerender(<Collapse open revealOverflowWhenOpen duration={200}>content</Collapse>);
    // Mid-transition it must still clip, or content spills outside the box.
    act(() => { vi.advanceTimersByTime(100); });
    expect(inner.style.overflow).toBe('hidden');

    act(() => { vi.advanceTimersByTime(150); });
    expect(inner.style.overflow).toBe('visible');
  });

  it('re-hides overflow as soon as it starts closing', () => {
    const { container, rerender } = render(
      <Collapse open revealOverflowWhenOpen duration={200}>content</Collapse>,
    );
    const inner = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    act(() => { vi.advanceTimersByTime(250); });
    expect(inner.style.overflow).toBe('visible');

    rerender(<Collapse open={false} revealOverflowWhenOpen duration={200}>content</Collapse>);
    expect(inner.style.overflow).toBe('hidden');
  });

  it('leaves overflow hidden when revealOverflowWhenOpen is not set', () => {
    const { container } = render(<Collapse open duration={0}>content</Collapse>);
    const inner = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    act(() => { vi.advanceTimersByTime(50); });
    expect(inner.style.overflow).toBe('hidden');
  });
});
