/** The five parts proposed by the home-1 batch (kit grow-2). */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextCard, KitButton, ListRow, UnitStrip } from '../index';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KIT_CSS = readFileSync(resolve(__dirname, '..', 'kit.css'), 'utf8');

describe('ContextCard art', () => {
  it('sits in the head, hidden from the tree, and a click on it reaches the card press', () => {
    const press = vi.fn();
    const { container } = render(
      <ContextCard title="Agents" onPress={press} art={<svg data-testid="art" />} figures={<span>6</span>} />,
    );
    const art = container.querySelector('.k-card__art')!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.parentElement?.classList.contains('k-card__head')).toBe(true);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // Decoration never catches a press: kit.css turns its pointer events off, so a press on it
    // lands on the card's stretched title (jsdom has no layout, so the rule itself is the check).
    expect(KIT_CSS).toMatch(/\.k-card__art \{[^}]*pointer-events: none/);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('shares the corner with actions: art first, the actions keep the corner', () => {
    const { container } = render(
      <ContextCard title="Billing" art={<svg />} actions={<KitButton quiet onClick={() => {}}>Scan</KitButton>} />,
    );
    const head = container.querySelector('.k-card__head')!;
    const kids = Array.from(head.children).map((c) => c.className);
    expect(kids).toEqual(['k-card__titles', 'k-card__art', 'k-card__actions']);
  });

  it('is not drawn while the card loads, and the foot keeps its place', () => {
    const { container } = render(<ContextCard title="" state="loading" art={<svg />} />);
    expect(container.querySelector('.k-card__art')).toBeNull();
    expect(container.querySelector('.k-card__foot')).not.toBeNull();
  });
});

describe('KitButton tone', () => {
  it('primary is a class on the kit button over the shared primary variant', () => {
    render(<KitButton tone="primary" onClick={() => {}}>Build</KitButton>);
    const b = screen.getByRole('button', { name: 'Build' });
    expect(b.className).toContain('k-btn--primary');
    expect(b.className).toContain('brightness-lock');
  });

  it('`quiet` is an alias of tone="quiet": the same class string', () => {
    render(<><KitButton quiet onClick={() => {}}>A</KitButton><KitButton tone="quiet" onClick={() => {}}>B</KitButton></>);
    expect(screen.getByRole('button', { name: 'A' }).className).toBe(screen.getByRole('button', { name: 'B' }).className);
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('k-btn--quiet');
  });

  it('default and an explicit tone win over the alias', () => {
    render(<><KitButton onClick={() => {}}>D</KitButton><KitButton quiet tone="primary" onClick={() => {}}>P</KitButton></>);
    expect(screen.getByRole('button', { name: 'D' }).className).not.toMatch(/k-btn--(quiet|primary)/);
    const p = screen.getByRole('button', { name: 'P' }).className;
    expect(p).toContain('k-btn--primary');
    expect(p).not.toContain('k-btn--quiet');
  });

  it('a busy primary keeps the real spinner and the double-submit guard', () => {
    render(<KitButton tone="primary" loading onClick={() => {}}>Build</KitButton>);
    const b = screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.disabled).toBe(true);
  });
});

describe('KitButton icon', () => {
  it('sits before the label as its own flex item, hidden from the tree, so it never wraps', () => {
    render(<KitButton icon={<svg data-testid="ic" />} onClick={() => {}}>Retry</KitButton>);
    const b = screen.getByRole('button', { name: 'Retry' });
    const icon = screen.getByTestId('ic').closest('.k-btn__icon')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    // Not inside the label span: a direct flex item of the button (through the Button's icon slot).
    const slot = icon.parentElement!;
    expect(slot.parentElement).toBe(b);
    expect(slot.nextElementSibling?.textContent).toBe('Retry');
    expect(b.className).toContain('k-btn');
  });

  it('busy: the spinner takes the icon slot', () => {
    render(<KitButton icon={<svg data-testid="ic" />} loading onClick={() => {}}>Retry</KitButton>);
    expect(screen.queryByTestId('ic')).toBeNull();
  });
});

describe('UnitStrip legend', () => {
  it('is the strip description: a hidden sentence it points at, merged with an existing one', () => {
    render(<UnitStrip label="120 runs" legend="5 runs" segments={[{ n: 24, tone: 'success' }]} aria-describedby="other" />);
    const strip = screen.getByRole('img', { name: '120 runs' });
    const ids = strip.getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('other');
    const node = document.getElementById(ids[1]!)!;
    expect(node.hidden).toBe(true);
    expect(node.textContent).toBe('1 unit = 5 runs');
  });

  it('draws the key visibly beside the strip, hidden from the tree, in the first claim tone', () => {
    const { container } = render(<UnitStrip label="x" size="s" legend="100k tokens" segments={[{ n: 0 }, { n: 3, tone: 'agent', glyph: 'soft' }]} />);
    const key = container.querySelector('.k-units__legend')!;
    expect(key.getAttribute('aria-hidden')).toBe('true');
    expect(key.textContent).toContain('100k tokens');
    expect(key.querySelector('.k-units--s .k-u.t-agent.g-soft')).not.toBeNull();
  });

  it('without a legend renders the strip alone, as before', () => {
    const { container } = render(<UnitStrip label="x" segments={[{ n: 2 }]} />);
    expect(container.firstElementChild?.getAttribute('data-kit')).toBe('UnitStrip');
    expect(container.querySelector('.k-units__legend')).toBeNull();
    expect(screen.getByRole('img', { name: 'x' }).hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('ListRow onPress', () => {
  it('the name is the row\'s one button; a click, Enter and Space press it', async () => {
    const user = userEvent.setup();
    const press = vi.fn();
    const { container } = render(<ListRow name="Deep link" onPress={press} />);
    const b = screen.getByRole('button', { name: 'Deep link' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('.k-row')!.classList.contains('is-pressable')).toBe(true);
    await user.click(b);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(document.activeElement).toBe(b);
    expect(press).toHaveBeenCalledTimes(3);
  });

  it('an inner action does not press the row', () => {
    const press = vi.fn();
    const own = vi.fn();
    render(<ListRow name="Row" onPress={press} figures={<KitButton quiet onClick={own}>Open</KitButton>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'Enter' });
    expect(own).toHaveBeenCalledTimes(1);
    expect(press).not.toHaveBeenCalled();
  });

  it('a selected pressable row is the current one; an unpressable row stays a plain name', () => {
    render(<><ListRow name="Sel" onPress={() => {}} state="selected" /><ListRow name="Plain" /></>);
    expect(screen.getByRole('button', { name: 'Sel' }).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Plain' })).toBeNull();
  });

  it('keeps the fixed row: same size class with or without a press', () => {
    const { container } = render(<><ListRow name="A" size="s" onPress={() => {}} /><ListRow name="B" size="s" /></>);
    const rows = container.querySelectorAll('.k-row');
    expect(rows[0]!.classList.contains('k-row--s')).toBe(true);
    expect(rows[1]!.classList.contains('k-row--s')).toBe(true);
  });
});
