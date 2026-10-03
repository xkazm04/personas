/** The three gaps the home-3 builders recorded with evidence and the kit closed on 2026-10-03:
 *  `Tile onPress`, a `Meta` that reads in a sentence, and a caller-declared `Rows nameWidth`.
 *  Each one is checked BOTH ways: the new shape works, and the shape every current caller has
 *  does not move - the backwards-compatibility half is the point, since other builders are live
 *  on consumers of these parts in the same checkout. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ListRow, Meta, Rows, Section, Tile, Tiles } from '../index';

const CSS = readFileSync(resolve(process.cwd(), 'src/features/shared/components/kit/kit.css'), 'utf8');

describe('Tile onPress (home-3 gap 1)', () => {
  it('the title is the tile\'s one button: one tab stop, the press on the tile', () => {
    const onPress = vi.fn();
    const { container } = render(
      <Tiles label="board"><Tile span={6} title="Enter this board" onPress={onPress}>body</Tile></Tiles>,
    );
    const button = screen.getByRole('button', { name: 'Enter this board' });
    expect(button.className).toContain('k-dtile__press');
    expect(button.closest('h3')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('.k-dtile')!.className).toContain('is-pressable');
    button.click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a selected pressable tile is the CURRENT board, never a toggle', () => {
    render(<Tiles label="board"><Tile title="Current" state="selected" onPress={() => {}} /></Tiles>);
    const button = screen.getByRole('button', { name: 'Current' });
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBeNull();
  });

  it('an unselected pressable tile carries no aria-current at all', () => {
    render(<Tiles label="board"><Tile title="Other" onPress={() => {}} /></Tiles>);
    expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBeNull();
  });

  it('the count stays OUT of the button, so the tile presses on its name alone', () => {
    render(<Tiles label="board"><Tile title="Runs" count={12} onPress={() => {}} /></Tiles>);
    expect(screen.getByRole('button', { name: 'Runs' }).textContent).toBe('Runs');
    expect(screen.getByText('12').className).toContain('k-count');
  });

  it('actions, the footer and a row in the body keep their own press', () => {
    const tile = vi.fn();
    const row = vi.fn();
    render(
      <Tiles label="board">
        <Tile title="Board" onPress={tile} actions={<button type="button" onClick={() => {}}>Scan</button>} footer={<button type="button" onClick={() => {}}>Re-run</button>}>
          <Rows count={1} empty={{ title: 'none' }}><ListRow name="a row" onPress={row} /></Rows>
        </Tile>
      </Tiles>,
    );
    screen.getByRole('button', { name: 'a row' }).click();
    expect(row).toHaveBeenCalledTimes(1);
    expect(tile).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Board', 'Scan', 'a row', 'Re-run']);
  });

  it('no title, no press: the title IS the button, so nothing else becomes one', () => {
    const { container } = render(<Tiles label="board"><Tile onPress={() => {}}>body</Tile></Tiles>);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.k-dtile')!.className).not.toContain('is-pressable');
  });

  it('a tile with no onPress is untouched: no button, no pressable class', () => {
    const { container } = render(<Tiles label="board"><Tile title="Plain" count={3}>body</Tile></Tiles>);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.k-dtile')!.className).not.toContain('is-pressable');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Plain3');
  });

  it('follows the card and row precedent rather than a third spelling', () => {
    // The same mechanism under the tile's own name: a stretched ::after, the focus ring on the
    // host, the press itself unringed.
    expect(CSS).toContain('.k-dtile__press::after { content: ""; position: absolute; inset: 0;');
    expect(CSS).toContain('.k-dtile.is-pressable:has(.k-dtile__press:focus-visible)');
    expect(CSS).toContain('.k-dtile__press:focus-visible { outline: 0; }');
    // The head and the title must give up their positioning context, or that ::after resolves to
    // the head and the hit area is the head alone.
    expect(CSS).toContain('.k-dtile.is-pressable :is(.k-dtile__head, .k-dtile__title) { position: static; }');
    // A nested row's own stretched hit area must NOT be re-anchored to its button.
    expect(CSS).toContain(':is(button, a, [tabindex]):not(.k-row__press, .k-card__press)');
  });
});

describe('Meta reads in a sentence (home-3 gap 2)', () => {
  it('adjacent string parts no longer glue to the dot', () => {
    render(<p data-testid="desc"><Meta parts={['7 days of traces', '30 days of crashes']} /></p>);
    expect(screen.getByTestId('desc').textContent).toBe('7 days of traces · 30 days of crashes');
  });

  it('a Section desc - the host a builder hand-rolled around - reads as one sentence', () => {
    const { container } = render(
      <Section title="Log disk usage" desc={<Meta parts={['Traces kept 7 days', 'crash reports 30 days']} />} />,
    );
    expect(container.querySelector('.k-section__desc')!.textContent).toBe('Traces kept 7 days · crash reports 30 days');
  });

  it('the flex meta line is byte-identical: the parts are still display:contents and the dot still carries no margin', () => {
    const { container } = render(
      <Rows count={1} empty={{ title: 'none' }}><ListRow name="row" meta={<Meta parts={['personas', 'opus-5-5', '19 turns']} />} /></Rows>,
    );
    const line = container.querySelector('.k-row__meta')!;
    expect(line.querySelectorAll('.k-meta__part')).toHaveLength(3);
    expect(line.querySelectorAll('.k-sep')).toHaveLength(2);
    expect(CSS).toContain('.k-meta__part { display: contents; }');
    expect(/\.k-sep \{[^}]*\}/.exec(CSS)?.[0]).not.toContain('margin');
  });

  it('empty parts are still dropped, and a lone part gets no separator', () => {
    render(<p data-testid="one"><Meta parts={['only', '', null, false, undefined]} /></p>);
    expect(screen.getByTestId('one').textContent).toBe('only');
  });

  it('the dot stays out of the accessibility tree', () => {
    const { container } = render(<p><Meta parts={['a', 'b']} /></p>);
    expect(container.querySelector('.k-sep')!.getAttribute('aria-hidden')).toBe('true');
  });
});

const COLS = [
  { head: 'Project', width: '10rem' },
  { head: 'Model', width: '7rem', collapse: true },
  { head: 'Tokens', width: '6rem', align: 'end' as const },
];

function list(nameWidth?: string) {
  return (
    <Rows count={2} empty={{ title: 'none' }} nameHead="Session" nameWidth={nameWidth} columns={COLS}>
      {['a', 'b'].map((id) => <ListRow key={id} size="s" name={`row ${id}`} cells={['personas', 'opus', '3.6M']} time="5m" />)}
    </Rows>
  );
}

describe('Rows nameWidth (home-3 gap 3)', () => {
  it('the declared track replaces the name\'s 1fr and the leftover room moves to the trail', () => {
    const { container } = render(list('26rem'));
    const host = container.querySelector('.k-rowcols') as HTMLElement;
    expect(host.style.getPropertyValue('--row-tracks')).toBe('minmax(0, 26rem) 10rem 7rem 6rem minmax(0, 1fr)');
    expect(host.className).toContain('k-rowcols--namefixed');
  });

  it('the name can still shrink on a cramped list: it is minmax(0, w), never a hard width', () => {
    const { container } = render(list('26rem'));
    expect((container.querySelector('.k-rowcols') as HTMLElement).style.getPropertyValue('--row-tracks-narrow'))
      .toBe('minmax(0, 26rem) 10rem 6rem minmax(0, 1fr)');
  });

  it('the trail keeps the right edge the 1fr track would otherwise hand it', () => {
    expect(CSS).toContain('.k-rowcols--namefixed .k-row__trail { justify-content: flex-end; }');
  });

  it('EVERY current caller is unchanged: no nameWidth, no class, the old track set', () => {
    const { container } = render(list());
    const host = container.querySelector('.k-rowcols') as HTMLElement;
    expect(host.style.getPropertyValue('--row-tracks')).toBe('minmax(0, 1fr) 10rem 7rem 6rem auto');
    expect(host.style.getPropertyValue('--row-tracks-narrow')).toBe('minmax(0, 1fr) 10rem 6rem auto');
    expect(host.className).not.toContain('k-rowcols--namefixed');
  });

  it('a capped list keeps the declared name track too', () => {
    const { container } = render(
      <Rows count={4} cap={2} empty={{ title: 'none' }} nameHead="Session" nameWidth="20rem" columns={COLS}>
        {['a', 'b', 'c', 'd'].map((id) => <ListRow key={id} name={id} cells={['p', 'm', '1']} />)}
      </Rows>,
    );
    const host = container.querySelector('.k-rowcols') as HTMLElement;
    expect(host.className).toContain('k-rowcols--namefixed');
    expect(host.style.getPropertyValue('--row-tracks')).toBe('minmax(0, 20rem) 10rem 7rem 6rem minmax(0, 1fr)');
    expect(container.querySelectorAll('.k-rows--cols > .k-row')).toHaveLength(2);
  });

  it('nameWidth without columns changes nothing: the LIST owns the shape, as cells do', () => {
    const { container } = render(
      <Rows count={1} empty={{ title: 'none' }} nameWidth="20rem"><ListRow name="plain" /></Rows>,
    );
    expect(container.querySelector('.k-rowcols')).toBeNull();
    expect(container.querySelector('.k-rows')!.className).not.toContain('k-rows--cols');
  });
});
