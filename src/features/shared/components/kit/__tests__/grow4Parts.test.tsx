/** The parts the Home review earned (kit grow-4): the emphasis recipe, row columns, Stack,
 *  ContextCard fill / figure / body, the Tile mark, KitButton describedBy and the calm ghost. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContextCard, DataTable, Hint, KitButton, ListRow, Rows, Stack, Tile, Tiles } from '../index';

describe('the emphasis recipe (grow-4 part 5)', () => {
  it('a ListRow name is 500 by default: the tinted title above it carries the 600', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Invoice Reconciler" /></Rows>);
    const name = screen.getByText('Invoice Reconciler');
    expect(name.className).toContain('k-medium');
    expect(name.className).not.toContain('k-strong');
  });

  it('the 600 exception is explicit: a caller opts in through nameClass', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Lone name" nameClass="typo-body k-strong" /></Rows>);
    expect(screen.getByText('Lone name').className).toContain('k-strong');
  });

  it('a ContextCard title follows the same recipe', () => {
    render(<ContextCard title="Authentication" />);
    expect(screen.getByText('Authentication').className).toContain('k-medium');
  });

  it('the empty band follows it too, so one rule covers the kit', () => {
    render(<Rows count={0} empty={{ title: 'Nothing here' }}>{null}</Rows>);
    expect(screen.getByText('Nothing here').className).toContain('k-medium');
  });
});

describe('the ghost is calm and delayed (grow-4 part 9)', () => {
  it('a list ghost is invisible for 150ms, then staggers at the 35ms the doctrine names', () => {
    const { container } = render(<Rows count={0} loading empty={{ title: 'none' }}>{null}</Rows>);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.k-row.is-loading'));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.style.getPropertyValue('--ghost-delay'))).toEqual(['150ms', '185ms', '220ms']);
  });

  it('a table ghost carries the same delay', () => {
    const { container } = render(
      <DataTable label="t" cols={[{ key: 'a', label: 'A' }]} rows={[]} loading empty={{ title: 'none' }} />,
    );
    const rows = Array.from(container.querySelectorAll<HTMLElement>('tr.is-loading'));
    expect(rows.map((r) => r.style.getPropertyValue('--ghost-delay'))).toEqual(['150ms', '185ms', '220ms']);
  });

  it('no shimmer is left: the ghost is a flat bar entering once, not a loop', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/shared/components/kit/kit.css'), 'utf8');
    expect(css).not.toContain('k-shimmer');
    const ghost = /\.k-ghost \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(ghost).toContain('k-ghost-in');
    expect(ghost).toContain('var(--ghost-delay, 150ms)');
    expect(ghost).not.toContain('infinite');
  });
});

describe('Stack (grow-4 part 3)', () => {
  it('names itself and owns the gap; `divided` is the opt-in rule, never a box', () => {
    const { container, rerender } = render(<Stack><p>a</p><p>b</p></Stack>);
    const plain = container.querySelector('.k-stack')!;
    expect(plain.getAttribute('data-kit')).toBe('Stack');
    expect(plain.className).toContain('k-stack--m');
    expect(plain.className).not.toContain('k-stack--divided');
    rerender(<Stack gap="s" divided><p>a</p><p>b</p></Stack>);
    const ruled = container.querySelector('.k-stack')!;
    expect(ruled.className).toContain('k-stack--s');
    expect(ruled.className).toContain('k-stack--divided');
  });

  it('the rule starts at the host band origin and is drawn, not bordered', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/shared/components/kit/kit.css'), 'utf8');
    const block = /\.k-stack--divided > \* \+ \* \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('var(--band-x)');
    expect(block).toContain('background-image');
    expect(block).not.toContain('border');
  });
});

describe('the two gaps home-2 recorded (grow-4 part 7)', () => {
  it('Tile mark: the tile carries its status on its own rail, not as a trailing word', () => {
    const { container } = render(
      <Tiles label="g"><Tile span={6} title="Services" mark={{ tone: 'error', label: 'Failing' }}>x</Tile></Tiles>,
    );
    const mark = container.querySelector('.k-dtile > .k-mark')!;
    expect(mark.getAttribute('aria-label')).toBe('Failing');
    expect(mark.className).toContain('t-error');
  });

  it('Tile mark is not drawn while the tile loads (its ghost owns the geometry)', () => {
    const { container } = render(
      <Tiles label="g"><Tile span={6} title="Services" state="loading" mark={{ tone: 'error', label: 'Failing' }} /></Tiles>,
    );
    expect(container.querySelector('.k-dtile > .k-mark')).toBeNull();
  });

  it('KitButton describedBy: a Hint around a button now describes its press', () => {
    render(<Hint content="Re-runs every failed execution"><KitButton onClick={() => {}}>Bulk re-run</KitButton></Hint>);
    const b = screen.getByRole('button', { name: 'Bulk re-run' });
    const id = b.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('Re-runs every failed execution');
  });

  it('describedBy and a Hint merge rather than one winning', () => {
    render(
      <>
        <span id="own">owned</span>
        <Hint content="from the hint"><KitButton describedBy="own" onClick={() => {}}>Act</KitButton></Hint>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Act' }).getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });
});

describe('ContextCard collapses to what it carries (grow-4 part 6)', () => {
  it('fill paints the quantity as the card background and figure states it in the corner', () => {
    const { container } = render(<ContextCard title="Getting Started" fill={{ value: 0.5, tone: 'success' }} figure="2/4" />);
    const card = container.querySelector('.k-card') as HTMLElement;
    expect(card.className).toContain('k-card--fill');
    expect(card.className).toContain('t-success');
    expect(card.style.getPropertyValue('--fill')).toBe('50%');
    expect(container.querySelector('.k-card__figure')?.textContent).toBe('2/4');
  });

  it('a fill is clamped to 0..1 and defaults to the primary tone', () => {
    const { container, rerender } = render(<ContextCard title="a" fill={{ value: 4 }} />);
    expect((container.querySelector('.k-card') as HTMLElement).style.getPropertyValue('--fill')).toBe('100%');
    expect((container.querySelector('.k-card') as HTMLElement).className).toContain('t-primary');
    rerender(<ContextCard title="a" fill={{ value: -2 }} />);
    expect((container.querySelector('.k-card') as HTMLElement).style.getPropertyValue('--fill')).toBe('0%');
  });

  it('no meta and no figures: the card is head only - the always-empty rows are gone', () => {
    const { container } = render(<ContextCard title="Getting Started" fill={{ value: 1 }} figure="4/4" />);
    expect(container.querySelector('.k-card__meta')).toBeNull();
    expect(container.querySelector('.k-card__foot')).toBeNull();
  });

  it('figures still get their foot, so grow-1 keeps its bottom-pinned figure line', () => {
    const { container } = render(<ContextCard title="a" figures={<span>12</span>} />);
    expect(container.querySelector('.k-card__foot')?.textContent).toBe('12');
  });

  it('children render between the head and the foot, and not while loading', () => {
    const { container, rerender } = render(<ContextCard title="a" figures={<span>12</span>}><p>body</p></ContextCard>);
    const kids = Array.from((container.querySelector('.k-card') as HTMLElement).children).map((c) => c.className);
    expect(kids).toEqual(['k-card__head', 'k-card__body', 'k-card__foot']);
    rerender(<ContextCard title="" state="loading"><p>body</p></ContextCard>);
    expect(container.querySelector('.k-card__body')).toBeNull();
  });

  it('a loading card still ghosts head and foot', () => {
    const { container } = render(<ContextCard title="" state="loading" />);
    expect(container.querySelector('.k-card__foot')).not.toBeNull();
  });
});
