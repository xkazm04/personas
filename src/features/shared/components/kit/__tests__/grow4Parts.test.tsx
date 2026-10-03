/** The parts the Home review earned (kit grow-4): the emphasis recipe, row columns, Stack,
 *  ContextCard fill / figure / body, the Tile mark, KitButton describedBy and the calm ghost. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContextCard, DataTable, Hint, KitButton, ListRow, Rows, Stack, Tile, Tiles } from '../index';

/** grow-4 part 5, corrected at home-3: the default is 400, not 500. `--font-sans` resolves to
 *  Segoe UI, which has no Medium, so 500 and 600 render at one identical advance - the grow-4
 *  default changed no pixels and these assertions passed over a no-op. `k-regular` is the first
 *  spelling of the recipe the font can actually draw apart from the title's 600. The assertions
 *  deliberately exclude BOTH heavier classes: a future edit that reaches for `k-medium` to make a
 *  name "slightly stronger" is the exact mistake this correction undid. */
describe('the emphasis recipe (grow-4 part 5, corrected home-3)', () => {
  it('a ListRow name is 400 by default: the tinted title above it carries the 600', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Invoice Reconciler" /></Rows>);
    const name = screen.getByText('Invoice Reconciler');
    expect(name.className).toContain('k-regular');
    expect(name.className).not.toContain('k-strong');
    expect(name.className).not.toContain('k-medium');
  });

  it('the 600 exception is explicit: a caller opts in through nameClass', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Lone name" nameClass="typo-body k-strong" /></Rows>);
    expect(screen.getByText('Lone name').className).toContain('k-strong');
  });

  it('a ContextCard title follows the same recipe', () => {
    render(<ContextCard title="Authentication" />);
    const title = screen.getByText('Authentication');
    expect(title.className).toContain('k-regular');
    expect(title.className).not.toContain('k-medium');
  });

  it('the empty band follows it too, so one rule covers the kit', () => {
    render(<Rows count={0} empty={{ title: 'Nothing here' }}>{null}</Rows>);
    const line = screen.getByText('Nothing here');
    expect(line.className).toContain('k-regular');
    expect(line.className).not.toContain('k-medium');
  });

  it('no kit part reaches for k-medium on a white name: it renders as 600 on this font', () => {
    const src = ['ListRow', 'ContextCard', 'ContextGroups', 'states', 'ChipRow']
      .map((f) => readFileSync(resolve(process.cwd(), `src/features/shared/components/kit/${f}.tsx`), 'utf8'))
      .join(' ');
    expect(src).not.toMatch(/className=[^>]{0,120}k-medium/);
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

const COLS = [
  { head: 'Project', width: '10rem' },
  { head: 'Model', width: '7rem', collapse: true },
  { head: 'Tokens', width: '6rem', align: 'end' as const },
];

function threeRows() {
  return (
    <Rows count={3} empty={{ title: 'none' }} nameHead="Session" columns={COLS}>
      {['a', 'b', 'c'].map((id) => (
        <ListRow key={id} size="s" name={`row ${id}`} cells={['personas', 'opus', '3.6M']} time="5m" />
      ))}
    </Rows>
  );
}

describe('Rows columns (grow-4 part 2)', () => {
  it('the track set is declared ONCE on the list, not per row', () => {
    const { container } = render(threeRows());
    const host = container.querySelector('.k-rowcols') as HTMLElement;
    expect(host.style.getPropertyValue('--row-tracks')).toBe('minmax(0, 1fr) 10rem 7rem 6rem auto');
    expect(container.querySelectorAll('.k-row[style]')).toHaveLength(0);
  });

  it('a collapsible column leaves the narrow track set, so the track goes with the cell', () => {
    const { container } = render(threeRows());
    const host = container.querySelector('.k-rowcols') as HTMLElement;
    expect(host.style.getPropertyValue('--row-tracks-narrow')).toBe('minmax(0, 1fr) 10rem 6rem auto');
    expect(container.querySelectorAll('[data-collapse]')).toHaveLength(4); // one head + three cells
  });

  it('every row fills the same columns, and a column carries its own alignment', () => {
    const { container } = render(threeRows());
    const rows = Array.from(container.querySelectorAll('.k-rows--cols > .k-row'));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('.k-row__cell'));
      expect(cells).toHaveLength(3);
      expect(cells[2]!.className).toContain('k-row__cell--end');
    }
  });

  it('the head line is drawn once and hidden from the tree; the cell carries the column name instead', () => {
    const { container } = render(threeRows());
    const head = container.querySelector('.k-rowhead')!;
    expect(head.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(head.children).map((c) => c.textContent)).toEqual(['Session', 'Project', 'Model', 'Tokens', '']);
    expect(container.querySelector('.k-row__cell')?.textContent).toBe('Project: personas');
  });

  it('the two-cell shape is still the default: no column set, no wrapper, no cells', () => {
    const { container } = render(
      <Rows count={1} empty={{ title: 'none' }}><ListRow name="plain" cells={['ignored']} /></Rows>,
    );
    expect(container.querySelector('.k-rowcols')).toBeNull();
    expect(container.querySelector('.k-row__cell')).toBeNull();
    expect(container.querySelector('.k-rows')!.className).not.toContain('k-rows--cols');
  });

  it('a capped list keeps its columns and its head', () => {
    const { container } = render(
      <Rows count={4} cap={2} empty={{ title: 'none' }} nameHead="Session" columns={COLS}>
        {['a', 'b', 'c', 'd'].map((id) => <ListRow key={id} name={id} cells={['p', 'm', '1']} />)}
      </Rows>,
    );
    expect(container.querySelector('.k-rowcols')).not.toBeNull();
    expect(container.querySelector('.k-rowhead')).not.toBeNull();
    expect(container.querySelectorAll('.k-rows--cols > .k-row')).toHaveLength(2);
  });
});
