/** The six parts proposed by the Factory and Observability batches (kit grow-1). */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ContextCard, ContextCards, Crumbs, DataTable, Hint, KitButton, Mark, quantumFor, UnitStrip } from '../index';

describe('Crumbs', () => {
  it('is a named nav; doors are buttons; a last plain crumb is the current page', () => {
    const up = vi.fn();
    render(<Crumbs label="Trail" items={[{ label: 'Factory' }, { label: 'Projects', onPress: up }, { label: 'Atlas' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Trail' });
    expect(nav.getAttribute('data-kit')).toBe('Crumbs');
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(up).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Atlas').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Factory').getAttribute('aria-current')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('passes no aria-current when every crumb is a door (the title names the current level)', () => {
    render(<Crumbs label="Trail" items={[{ label: 'Factory' }, { label: 'Projects', onPress: () => {} }]} />);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });
});

describe('KitButton', () => {
  it('disabled: native disabled on the shared Button, click inert', () => {
    const onClick = vi.fn();
    render(<KitButton disabled onClick={onClick}>Scan</KitButton>);
    const b = screen.getByRole('button', { name: 'Scan' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabledReason: the reason is reachable on a focusable wrapper', () => {
    render(<KitButton disabled disabledReason="No project" onClick={() => {}}>Scan</KitButton>);
    expect(screen.getByRole('button', { name: 'Scan' }).parentElement?.getAttribute('tabindex')).toBe('0');
  });

  it('stopPropagation: a press inside a clickable row does not reach the row', () => {
    const row = vi.fn();
    const own = vi.fn();
    render(
      <div onClick={row} onKeyDown={row}>
        <KitButton stopPropagation onClick={own}>Open</KitButton>
        <KitButton onClick={own}>Plain</KitButton>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'Enter' });
    expect(own).toHaveBeenCalledTimes(1);
    expect(row).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(row).toHaveBeenCalledTimes(1);
  });

  it('stopPropagation keeps the busy guard: a promise from onClick is returned to the Button', async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<KitButton stopPropagation onClick={onClick}>Save</KitButton>);
    const b = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
  });
});

describe('DataTable column width', () => {
  type K = 'name' | 'n';
  const rows = [{ id: 'a', cells: { name: 'alpha', n: '2' } }];
  it('sets width and min-width on the head and every cell of a column that asks, nothing elsewhere', () => {
    const { container } = render(
      <DataTable<K> label="t" cols={[{ key: 'name', label: 'Name' }, { key: 'n', label: 'N', num: true, width: '8rem' }]} rows={rows} empty={{ title: 'none' }} />,
    );
    const [thName, thN] = Array.from(container.querySelectorAll('th')) as HTMLElement[];
    const [tdName, tdN] = Array.from(container.querySelectorAll('tbody td')) as HTMLElement[];
    expect(thN!.style.width).toBe('8rem');
    expect(thN!.style.minWidth).toBe('8rem');
    expect(tdN!.style.width).toBe('8rem');
    expect(tdN!.style.minWidth).toBe('8rem');
    expect(thName!.getAttribute('style')).toBeNull();
    expect(tdName!.getAttribute('style')).toBeNull();
  });
  it('keeps the track on a loading table', () => {
    const { container } = render(
      <DataTable<K> label="t" loading cols={[{ key: 'name', label: 'Name' }, { key: 'n', label: 'N', width: '6rem' }]} rows={[]} empty={{ title: 'none' }} />,
    );
    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td')) as HTMLElement[];
    expect(cells[1]!.style.minWidth).toBe('6rem');
  });
});

describe('quantumFor', () => {
  it('nothing to draw returns the floor', () => {
    expect(quantumFor(0, 40)).toBe(1);
    expect(quantumFor(-5, 40)).toBe(1);
    expect(quantumFor(Number.NaN, 40, 0.1)).toBe(0.1);
    expect(quantumFor(0, 24, 0.5)).toBe(0.5);
  });
  it('one unit and small totals stay at the floor', () => {
    expect(quantumFor(1, 60)).toBe(1);
    expect(quantumFor(60, 60)).toBe(1);
    expect(quantumFor(61, 60)).toBe(2);
    expect(quantumFor(0.3, 60, 0.1)).toBe(0.1);
  });
  it('walks the 1-2-5 ladder and keeps the strip at or under maxUnits', () => {
    expect(quantumFor(121, 60)).toBe(5);
    expect(quantumFor(300, 60)).toBe(5);
    expect(quantumFor(301, 60)).toBe(10);
    expect(quantumFor(7.3, 24, 0.5)).toBe(0.5);
    expect(quantumFor(13, 24, 0.5)).toBe(1);
    expect(quantumFor(1000, 10)).toBe(100);
  });
  it('huge totals still land on a ladder step that fits', () => {
    const q = quantumFor(9.3e12, 60);
    expect(q).toBe(200_000_000_000);
    expect(9.3e12 / q).toBeLessThanOrEqual(60);
  });
  it('bad maxUnits or min fall back instead of looping', () => {
    expect(quantumFor(10, 0)).toBe(10);
    expect(quantumFor(10, 60, 0)).toBe(1);
  });
});

describe('Hint', () => {
  it('describes a Mark through an always-present hidden node, never a title attribute', () => {
    render(<Hint content="Failing for 3 runs"><Mark tone="error" label="Failing" /></Hint>);
    const mark = screen.getByRole('img', { name: 'Failing' });
    const id = mark.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)?.textContent).toBe('Failing for 3 runs');
    expect(document.getElementById(id)?.hidden).toBe(true);
    expect(mark.hasAttribute('title')).toBe(false);
    expect(mark.hasAttribute('tabindex')).toBe(false);
  });
  it('merges an existing description and makes a standalone trigger focusable on request', () => {
    render(<Hint content="1 square = 5 runs" focusable><UnitStrip label="12 runs" segments={[{ n: 2 }]} aria-describedby="legend" /></Hint>);
    const strip = screen.getByRole('img', { name: '12 runs' });
    expect(strip.getAttribute('aria-describedby')).toMatch(/^legend /);
    expect(strip.getAttribute('tabindex')).toBe('0');
  });
  it('shows the shared tooltip on focus', async () => {
    vi.useFakeTimers();
    render(<Hint content="p95 over the window" focusable><span className="typo-data">412 ms</span></Hint>);
    fireEvent.focus(screen.getByText('412 ms'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    // Visible once the rAF positions it; mounted (with the text) as soon as the delay passes.
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('p95 over the window');
    vi.useRealTimers();
  });
});

describe('ContextCard', () => {
  it('renders name, meta, figures, actions and its mark on the rail', () => {
    const act1 = vi.fn();
    render(
      <ContextCards label="Contexts">
        <ContextCard title="Auth" meta="12 files" figures={<span>3 KPIs</span>} actions={<KitButton onClick={act1}>Scan</KitButton>} mark={{ tone: 'warning', label: 'At risk' }} />
      </ContextCards>,
    );
    expect(screen.getByRole('group', { name: 'Contexts' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'At risk' })).toBeTruthy();
    expect(screen.getByText('12 files')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    expect(act1).toHaveBeenCalled();
  });
  it('a pressable card has one title button; selected sets aria-pressed; actions are siblings, not nested', () => {
    const press = vi.fn();
    const { container } = render(<ContextCard title="Billing" onPress={press} state="selected" actions={<KitButton onClick={() => {}}>Open</KitButton>} />);
    const title = screen.getByRole('button', { name: 'Billing' });
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(title.querySelector('button')).toBeNull();
    fireEvent.click(title);
    expect(press).toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute('data-kit-state')).toBe('selected');
  });
  it('loading keeps the geometry with ghosts; empty shows its spec with a hollow mark', () => {
    const { container, rerender } = render(<ContextCard title="Auth" meta="12 files" state="loading" />);
    expect(container.querySelectorAll('.k-ghost').length).toBeGreaterThan(0);
    expect(screen.queryByText('12 files')).toBeNull();
    rerender(<ContextCard title="Auth" meta="12 files" state="empty" empty={{ title: 'Not scanned yet' }} />);
    expect(screen.getByText('Not scanned yet')).toBeTruthy();
    expect(screen.queryByText('12 files')).toBeNull();
    expect(container.querySelector('.k-mark.g-hollow')).toBeTruthy();
  });
});
