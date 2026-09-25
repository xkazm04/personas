/** ContextCard's one layout, and the parent layer over many contexts (kit grow-1, owner round 2). */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  CARD_LEVEL_MAX, ContextCard, ContextCards, ContextOverview, KitButton, MATCH_CAP, contextLevel, type ContextGroup,
} from '../index';

interface C { id: string; name: string }

/** 320 contexts in 22 groups, the owner's scale (sizes 64 down to 1). */
const SIZES = [64, 38, 30, 24, 20, 18, 16, 14, 12, 12, 10, 9, 8, 8, 7, 6, 6, 5, 5, 4, 3, 1];
const GROUPS: Array<ContextGroup<C>> = SIZES.map((n, gi) => ({
  id: `g${gi}`, name: `Group ${gi}`, count: n,
  mark: { tone: gi % 3 ? 'success' : 'error', label: gi % 3 ? 'On track' : 'Off track' },
  states: [{ n: Math.ceil(n / 4), tone: 'error' }, { n: n - Math.ceil(n / 4), tone: 'success', glyph: 'soft' }],
  figures: [n, `$${n}`],
  contexts: Array.from({ length: n }, (_, i) => ({ id: `c${gi}-${i}`, name: `ctx ${gi}-${i}${i % 5 === 0 ? ' api' : ''}` })),
}));

function Harness({ initialOpen = null }: { initialOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [query, setQuery] = useState('');
  return (
    <ContextOverview<C>
      label="Contexts" rootLabel="All contexts" groups={GROUPS} open={open} onOpen={setOpen} query={query} onQuery={setQuery}
      searchPlaceholder="Search contexts" match={(c, q) => c.name.includes(q)} unitLabel={(g) => `${g.count} contexts`}
      legend={(q) => `1 square = ${q}`} figureHeads={['Size', 'Cost']} empty={{ title: 'none' }}
      renderGroup={(g, level) => (level === 'cards'
        ? <ContextCards label="cards">{g.contexts.map((c) => <ContextCard key={c.id} title={c.name} />)}</ContextCards>
        : <table data-testid="level2-table"><tbody>{g.contexts.map((c) => <tr key={c.id}><td>{c.name}</td></tr>)}</tbody></table>)}
      renderMatches={(m, total) => <div data-testid="matches" data-total={total}>{m.map((c) => <span key={c.id} className="match">{c.name}</span>)}</div>}
    />
  );
}

describe('ContextCard layout', () => {
  it('every card has the same skeleton: head (titles + actions) then foot, whatever it carries', () => {
    const { container } = render(
      <ContextCards label="row">
        <ContextCard title="With action" meta="m" figures={<span>3 KPIs</span>} actions={<KitButton onClick={() => {}}>Scan</KitButton>} />
        <ContextCard title="Without" meta="m" figures={<span>2 KPIs</span>} />
        <ContextCard title="Empty" state="empty" empty={{ title: 'Not scanned', hint: 'Run a scan' }} actions={<KitButton onClick={() => {}}>Scan</KitButton>} />
        <ContextCard title="" state="loading" />
      </ContextCards>,
    );
    for (const card of Array.from(container.querySelectorAll('.k-card'))) {
      const kids = Array.from(card.children).filter((el) => !el.classList.contains('k-mark')).map((el) => el.className);
      expect(kids).toEqual(['k-card__head', 'k-card__foot']);
    }
    // Actions live in the head, never in the foot, so a card with actions keeps its figure line.
    const withAction = container.querySelectorAll('.k-card')[0]!;
    expect(withAction.querySelector('.k-card__head .k-card__actions button')?.textContent).toBe('Scan');
    expect(withAction.querySelector('.k-card__foot')?.textContent).toBe('3 KPIs');
    // Empty: the title goes on the meta line, the hint on the foot.
    const empty = container.querySelectorAll('.k-card')[2]!;
    expect(empty.querySelector('.k-card__meta')?.textContent).toBe('Not scanned');
    expect(empty.querySelector('.k-card__foot')?.textContent).toBe('Run a scan');
  });
});

describe('contextLevel', () => {
  it('cards up to CARD_LEVEL_MAX, a table past it', () => {
    expect(CARD_LEVEL_MAX).toBe(12);
    expect(contextLevel(1)).toBe('cards');
    expect(contextLevel(12)).toBe('cards');
    expect(contextLevel(13)).toBe('table');
  });
});

describe('ContextOverview at 320 contexts in 22 groups', () => {
  it('level 1 mounts one row per group and no card', () => {
    const t0 = performance.now();
    const { container } = render(<Harness />);
    const ms = performance.now() - t0;
    expect(container.querySelectorAll('.k-grp:not(.k-grp--head)')).toHaveLength(22);
    expect(container.querySelectorAll('.k-card')).toHaveLength(0);
    // One tab stop for the whole list (roving).
    expect(container.querySelectorAll('.k-grp[tabindex="0"]')).toHaveLength(1);
    console.info(`[render-cost] level 1: 22 rows, ${container.querySelectorAll('*').length} nodes, ${ms.toFixed(1)} ms (jsdom)`);
  });

  it('opening a small group mounts only its cards, with Crumbs back up; returning focuses its row', () => {
    const { container } = render(<Harness />);
    fireEvent.click(container.querySelector('[data-group="g12"]')!);
    expect(container.querySelectorAll('.k-card')).toHaveLength(8);
    expect(container.querySelectorAll('.k-grp')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /Group 12/ })).toBeTruthy();
    const back = screen.getByRole('button', { name: 'All contexts' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(document.activeElement).toBe(container.querySelector('[data-group="g12"]'));
  });

  it('a large group goes to the table level', () => {
    render(<Harness initialOpen="g0" />);
    expect(screen.getByTestId('level2-table').querySelectorAll('tr')).toHaveLength(64);
  });

  it('search reaches every context and hands over at most MATCH_CAP, with the total', () => {
    const { container } = render(<Harness />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'api' } });
    const m = screen.getByTestId('matches');
    expect(Number(m.dataset.total)).toBe(GROUPS.reduce((a, g) => a + g.contexts.filter((c) => c.name.includes('api')).length, 0));
    expect(m.querySelectorAll('.match').length).toBe(Math.min(MATCH_CAP, Number(m.dataset.total)));
    expect(container.querySelectorAll('.k-grp')).toHaveLength(0);
  });

  it('arrow keys rove the one tab stop', () => {
    const { container } = render(<Harness />);
    const first = container.querySelector<HTMLElement>('[data-group="g0"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(container.querySelector('[data-group="g1"]'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(container.querySelector('[data-group="g21"]'));
    expect(container.querySelector('[data-group="g21"]')?.getAttribute('tabindex')).toBe('0');
  });

  it('render cost against a flat grid of the same 320 contexts (logged for the report)', () => {
    const t0 = performance.now();
    const flat = render(<ContextCards label="all">{GROUPS.flatMap((g) => g.contexts).map((c) => <ContextCard key={c.id} title={c.name} />)}</ContextCards>);
    const flatMs = performance.now() - t0;
    const flatNodes = flat.container.querySelectorAll('*').length;
    flat.unmount();
    const t1 = performance.now();
    const lvl = render(<Harness />);
    const lvlMs = performance.now() - t1;
    const lvlNodes = lvl.container.querySelectorAll('*').length;
    console.info(`[render-cost] flat 320 cards: ${flatNodes} nodes ${flatMs.toFixed(1)} ms; level 1: ${lvlNodes} nodes ${lvlMs.toFixed(1)} ms (jsdom)`);
    expect(lvlNodes).toBeLessThan(flatNodes / 2);
  });
});
