/** The dashboard tile (kit grow-3): Tiles / Tile and the Rows cap. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KitButton, ListRow, Rows, Tile, Tiles } from '../index';

const KIT_CSS = readFileSync(resolve(__dirname, '..', 'kit.css'), 'utf8');
/** The declarations of the first rule whose selector is exactly `sel` (e.g. `.k-dtiles`). */
const rule = (sel: string) => KIT_CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')).find(([head]) => head?.trim() === sel)?.[1] ?? '';

describe('Tiles grid', () => {
  it('is a labelled group; a tile spans its columns, clamped to 1..12', () => {
    render(<Tiles label="Cockpit"><Tile span={7} title="Decisions" /><Tile span={40} /><Tile span={0} /></Tiles>);
    const grid = screen.getByRole('group', { name: 'Cockpit' });
    expect(grid.classList.contains('k-dtiles')).toBe(true);
    const tiles = Array.from(grid.children) as HTMLElement[];
    expect(tiles.map((t) => t.dataset.span)).toEqual(['7', '12', '1']);
    expect(tiles[0]!.style.getPropertyValue('--span')).toBe('7');
  });

  it('rows are content-sized and a tile never clips or scrolls', () => {
    const grid = rule('.k-dtiles');
    expect(grid).toMatch(/grid-auto-rows: auto/);
    expect(grid).not.toMatch(/grid-auto-rows: \d/);
    for (const sel of ['.k-dtiles', '.k-dtile', '.k-dtile__body']) {
      expect(rule(sel)).not.toBe('');
      expect(rule(sel)).not.toMatch(/overflow|(?<!min-)height:|max-height/);
    }
  });

  it('collapses spans by its own width: 1-3 become 6 under 1100px, all full under 720px; a stack ignores spans', () => {
    expect(KIT_CSS).toMatch(/container: tiles \/ inline-size/);
    expect(KIT_CSS).toMatch(/@container tiles \(max-width: 1099px\) \{\s*\.k-dtiles:not\(\.k-dtiles--stack\) > \.k-dtile:is\(\[data-span="1"\], \[data-span="2"\], \[data-span="3"\]\) \{ grid-column: span 6; \}/);
    expect(KIT_CSS).toMatch(/@container tiles \(max-width: 719px\) \{\s*\.k-dtiles:not\(\.k-dtiles--stack\) > \.k-dtile \{ grid-column: 1 \/ -1; \}/);
    render(<Tiles label="Chat" cols={1}><Tile span={4} /></Tiles>);
    expect(screen.getByRole('group', { name: 'Chat' }).classList.contains('k-dtiles--stack')).toBe(true);
  });
});

describe('Tile', () => {
  it('has one look: no look switch survives the gate, and the band sits on a rail', () => {
    expect(KIT_CSS).not.toMatch(/data-kit-tile-look/);
    expect(rule('.k-dtile::before')).toMatch(/left: 0/);
  });

  it('a stretched tile puts its pager on its foot', () => {
    expect(rule('.k-dtile__body')).toMatch(/flex: 1 0 auto/);
    expect(rule('.k-dtile__body > .k-pager')).toMatch(/margin-top: auto/);
  });

  it('a titled tile is a region named by its h3; an untitled one is a plain box', () => {
    render(<><Tile title="Fleet vitals" count={6}>body</Tile><Tile>metric</Tile></>);
    const region = screen.getByRole('region', { name: /Fleet vitals/ });
    expect(region.querySelector('h3')?.textContent).toContain('Fleet vitals');
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByText('metric').closest('.k-dtile')?.tagName).toBe('DIV');
  });

  it('the footer sits inside the tile, after the body, pinned by margin-top auto', () => {
    const { container } = render(<Tile title="Waiting" footer={<KitButton onClick={() => {}}>Approve</KitButton>}>text</Tile>);
    const kids = Array.from(container.querySelector('.k-dtile')!.children).map((c) => c.className);
    expect(kids).toEqual(['k-dtile__head', 'k-dtile__body', 'k-dtile__foot']);
    expect(rule('.k-dtile__foot')).toMatch(/margin-top: auto/);
  });

  it('loading ghosts its rows and hides actions and footer; empty and error are the empty band', () => {
    const { container, rerender } = render(<Tile title="T" state="loading" ghostRows={2} actions={<span>act</span>} footer={<span>foot</span>} />);
    expect(container.querySelectorAll('.k-row.is-loading')).toHaveLength(2);
    expect(screen.queryByText('act')).toBeNull();
    expect(screen.queryByText('foot')).toBeNull();
    rerender(<Tile title="T" state="empty" empty={{ title: 'Nothing yet' }} />);
    expect(container.querySelector('[data-empty]')?.textContent).toContain('Nothing yet');
    const retry = vi.fn();
    rerender(<Tile title="T" error={{ title: 'Could not load', action: <KitButton onClick={retry}>Retry</KitButton> }} footer={<span>foot</span>}>rows</Tile>);
    expect(container.querySelector('.k-dtile')!.classList.contains('is-error')).toBe(true);
    expect(screen.queryByText('rows')).toBeNull();
    expect(screen.queryByText('foot')).toBeNull();
    expect(container.querySelector('.k-mark.t-error')).not.toBeNull();
  });
});

describe('Rows cap', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => <ListRow key={i} name={`Row ${i + 1}`} />);

  it('shows the first N, then "Show all" expands in place and announces the count; it collapses back', async () => {
    const user = userEvent.setup();
    const { container } = render(<Rows count={31} cap={6} empty={{ title: '' }} label="Decisions">{rows(31)}</Rows>);
    expect(container.querySelectorAll('.k-row')).toHaveLength(6);
    const more = screen.getByRole('button', { name: 'Show all 31' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await user.click(more);
    expect(container.querySelectorAll('.k-row')).toHaveLength(31);
    expect(screen.getByRole('status').textContent).toBe('Showing all 31');
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(container.querySelectorAll('.k-row')).toHaveLength(6);
    expect(screen.getByRole('status').textContent).toBe('Showing the first 6');
  });

  it('a list at or under the cap renders plainly, with no control', () => {
    const { container } = render(<Rows count={4} cap={6} empty={{ title: '' }}>{rows(4)}</Rows>);
    expect(container.querySelectorAll('.k-row')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
