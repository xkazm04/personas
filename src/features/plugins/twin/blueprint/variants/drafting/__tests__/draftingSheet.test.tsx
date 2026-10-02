/**
 * The drafting variant's look, "Personas blueprint" (spark
 * twin-portable-blueprint; round 4 kept round 3's level 3 as the only look).
 * Asserted on the DOM it renders and on its real stylesheets, never on pixels:
 *
 * - it draws on its own paper (none of Studio's sheet);
 * - every region and the title block is a card laid on the sheet, framed first
 *   and filled with the next wave, construction lines past its corners;
 * - Personas has the type and the vocabulary: app titles and eyebrows, an icon
 *   chip per section, the twin's brand glyph traced on the title card, a
 *   readiness ring, the slots as kit status dots, layer one's memories as one
 *   composition bar (the zoom keeps the tallies);
 * - the blueprint stays: the 80/16 px drafting grid and the drawn sheet border
 *   in a dark and a light theme, paper and ink read from the theme's primary
 *   (computed from the real stylesheets);
 * - the drafting stylesheets carry no colour literal at all.
 *
 * The schedule's invariants are in drawSchedule.test.tsx.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import { FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH } from '../../../__fixtures__/blueprintFixtures';
import DraftingBlueprint from '../index';

const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];
const FIXTURES: Array<[string, TwinBlueprintModel]> = [['empty', FIXTURE_EMPTY], ['one channel', FIXTURE_ONE_CHANNEL], ['rich', FIXTURE_RICH]];

function props(over: Partial<BlueprintVariantProps> = {}): BlueprintVariantProps {
  return { model: FIXTURE_RICH, mode: 'detail', focus: null, onFocus: vi.fn(), onOpenDetail: vi.fn(), delta: null, working: false, reduced: false, ...over };
}
const root = () => screen.getByTestId('twin-blueprint-drafting');
const drawing = () => document.querySelector('[data-draw-root][data-draw-state="drawing"]')!;
const at = (el: Element | null | undefined) => Number(el?.getAttribute('data-draw-at'));
const depth = (el: Element | null | undefined) => el?.getAttribute('data-draw-depth');

describe('the Personas blueprint renders on its own paper', () => {
  it.each(FIXTURES)('%s: L1, every L2 and the stage, with no theme switch and none of Studio\'s sheet', (_name, model) => {
    const views = [
      { over: { model }, check: () => SECTIONS.forEach((s) => expect(screen.getByTestId(`twd-region-${s}`)).toBeInTheDocument()) },
      ...SECTIONS.map((focus) => ({ over: { model, focus }, check: () => expect(screen.getByTestId(`twd-focus-${focus}`)).toBeInTheDocument() })),
      { over: { model, mode: 'stage' as const, delta: FIXTURE_DELTA_RECONCILED }, check: () => expect(screen.getByTestId('twd-notes')).toBeInTheDocument() },
    ];
    for (const v of views) {
      const view = render(<DraftingBlueprint {...props(v.over)} />);
      expect(root()).toHaveClass('twd-sheet');
      expect(document.querySelector('.drafting-root')).toBeNull();
      v.check();
      view.unmount();
    }
  });
});

describe('the regions and the title block are cards drawn on the sheet', () => {
  it('the sheet and its border stay; every card is framed first and filled with the next wave', () => {
    render(<DraftingBlueprint {...props()} />);
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();
    const cards = [...SECTIONS.map((s) => screen.getByTestId(`twd-region-${s}`)), screen.getByTestId('twd-title-block')];
    for (const card of cards) {
      expect(card).toHaveClass('twd-card');
      expect(depth(card.querySelector(':scope > svg[data-draw-svg="outline"] [data-draw="frame"]'))).toBe('0');
      const fill = card.querySelector(':scope > .twd-card-fill');
      expect(fill).toHaveAttribute('data-draw-wipe', 'fade');
      expect(depth(fill)).toBe('1');
      // Construction lines run on past each corner, traced with the fill.
      const lines = card.querySelectorAll(':scope > svg.twd-construction [data-draw="frame"]');
      expect(lines).toHaveLength(4);
      lines.forEach((c) => expect(depth(c)).toBe('1'));
    }
    // Six frames stand at depth 0: the sheet border, four regions and the title block.
    expect(drawing().querySelectorAll('[data-draw-depth="0"]')).toHaveLength(6);
  });

  it('the zoom and the stage notes are cards too', () => {
    const l2 = render(<DraftingBlueprint {...props({ focus: 'voice' })} />);
    expect(screen.getByTestId('twd-focus-voice').querySelector(':scope > .twd-card > .twd-card-fill')).not.toBeNull();
    l2.unmount();
    render(<DraftingBlueprint {...props({ mode: 'stage' })} />);
    expect(screen.getByTestId('twd-notes')).toHaveClass('twd-card');
  });
});

describe('Personas has the type and the vocabulary', () => {
  it('section names are app titles and labels app eyebrows, never the drafting lettering', () => {
    render(<DraftingBlueprint {...props()} />);
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`).querySelector('header .typo-title')).not.toBeNull();
    expect(document.querySelectorAll('.typo-eyebrow').length).toBeGreaterThan(5);
    // The lettering's spaced capitals stay only where a drawing letters a mark (a language balloon).
    for (const el of document.querySelectorAll('[style*="letter-spacing: 0.1em"]')) expect(el.closest('[data-testid="twd-region-identity"]')).not.toBeNull();
  });

  it('an icon chip names each section; the brand glyph is traced on the title card; readiness a ring; slots in the twin status roles', () => {
    render(<DraftingBlueprint {...props()} />);
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`).querySelector(`header [data-section-icon="${s}"]`)).not.toBeNull();
    // The twin's brand glyph: its two profiles traced stroke by stroke.
    const title = screen.getByTestId('twd-title-block');
    const mark = title.querySelector('[data-section-icon="identity"]')!;
    expect(mark.querySelectorAll('path[data-draw="stroke"]')).toHaveLength(2);
    // Readiness: a ring inked to the score, its figure pressed after every other part.
    expect(title.querySelector('.twd-ring')).toHaveAttribute('data-draw', 'ink');
    const press = title.querySelector('[data-draw="press"]')!;
    const ends = Array.from(drawing().querySelectorAll('[data-draw-at]:not([data-draw="press"])')).map((el) => at(el) + Number(el.getAttribute('data-draw-for')));
    expect(at(press)).toBeGreaterThanOrEqual(Math.max(...ends));
    expect(document.querySelectorAll('[data-slot] .k-dot.t-success.g-solid')).toHaveLength(4);
  });

  it('layer one\'s memories are one composition bar in the status roles; the zoom keeps the tallies (the counting signature)', () => {
    const l1 = render(<DraftingBlueprint {...props()} />);
    const knowledge = screen.getByTestId('twd-region-knowledge');
    expect(knowledge.querySelector('[data-tally]')).toBeNull();
    expect(knowledge.querySelectorAll('[data-part]').length).toBeGreaterThan(0);
    l1.unmount();
    render(<DraftingBlueprint {...props({ focus: 'knowledge' })} />);
    expect(screen.getByTestId('twd-focus-knowledge').querySelectorAll('[data-tally]').length).toBeGreaterThanOrEqual(3);
  });
});

const DIR = resolve(process.cwd(), 'src/features/plugins/twin/blueprint/variants/drafting');
/** Every stylesheet the variant ships. */
const SHEETS = ['sheet.css', 'twinDrafting.css', 'draw/draw.css'];
const read = (file: string) => readFileSync(resolve(DIR, file), 'utf8');

/**
 * The real stylesheet, injected into the document so jsdom cascades it onto
 * the rendered root (it resolves custom properties to their declared text,
 * which is what is asserted: what each value is MADE of).
 */
describe('the blueprint stays (computed from the stylesheet)', () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = read('sheet.css');
    document.head.appendChild(style);
  });
  afterEach(() => {
    style.remove();
    document.documentElement.removeAttribute('data-theme');
  });

  it.each([['dark', null], ['light', 'light']] as const)('%s theme: the drafting grid and the sheet border, paper and ink from the primary', (_mode, dataTheme) => {
    if (dataTheme) document.documentElement.setAttribute('data-theme', dataTheme);
    render(<DraftingBlueprint {...props()} />);
    const cs = getComputedStyle(root());
    // The 80/16 px drafting grid, drawn from the sheet's own grid inks.
    expect(cs.backgroundSize).toContain('80px 80px, 80px 80px, 16px 16px, 16px 16px');
    expect(cs.backgroundImage.match(/linear-gradient\((?:90deg, )?var\(--grid-(?:major|fine)\) 1px, transparent 1px\)/g)).toHaveLength(4);
    expect(cs.getPropertyValue('--grid-major')).toContain('--primary');
    expect(cs.getPropertyValue('--grid-fine')).toContain('--primary');
    expect(cs.backgroundColor).toBe('var(--paper)');
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();
    // No foreign blue: the paper and the ink are the theme's own.
    expect(cs.getPropertyValue('--paper')).toContain('--primary');
    expect(cs.getPropertyValue('--ink')).toContain('--primary');
  });
});

/**
 * The stylesheets, read as text: stripped of comments, `var(--*)`, numbers
 * with units, the colour and gradient functions and their keywords, a
 * declaration that can carry a colour has nothing left that could name one.
 */
describe('the drafting stylesheets carry no colour literal at all', () => {
  const KEYWORDS = new Set([
    'color-mix', 'in', 'srgb', 'oklab', 'transparent', 'currentColor', 'none', 'linear-gradient', 'radial-gradient', 'repeating-linear-gradient',
    'drop-shadow', 'circle', 'at', 'deg', 'inset', 'solid', 'ease-out', 'isolate', 'calc', 'box-shadow', 'background-color',
  ]);
  /** Every `prop: value;` in a stylesheet, however deeply its rule is nested (`@container`, `@keyframes`). */
  const parse = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value!.trim() }));
  /** Properties that can carry a colour; custom properties always can. */
  const COLOURED = /^(--|background|color|border|box-shadow|fill|stroke|filter|outline|text-shadow|caret-color|accent-color|column-rule)/;
  const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|--drafting-blue|--twd-cyan/i;
  /** What could name a colour in a value: a literal, an anchor, or any word that is not a token, a number or a known keyword. */
  const ownColours = (value: string): string[] => {
    const literal = value.match(new RegExp(LITERAL.source, 'gi')) ?? [];
    const words = value
      .replace(/var\(--[\w-]+(?:,[^()]*)?\)/g, ' ')
      .replace(/-?\d*\.?\d+(?:px|rem|em|%|deg|ms)?/g, ' ')
      .replace(/[(),/]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !KEYWORDS.has(w));
    return [...literal, ...words];
  };

  it('the check itself finds a planted literal, a named colour and a foreign anchor', () => {
    const planted = parse('.x { --ink: color-mix(in srgb, var(--primary) 70%, #7fd3f7); color: blue; --paper: var(--drafting-blue); }');
    const [hex, named, anchor] = planted.map((d) => ownColours(d.value));
    expect(hex).toContain('#7fd3f7');
    expect(named).toEqual(['blue']);
    expect(anchor).toEqual(['--drafting-blue']);
  });

  it.each(SHEETS)('%s names no colour of its own', (file) => {
    const found = parse(read(file));
    expect(found.length).toBeGreaterThan(3);
    for (const { prop, value } of found) {
      expect(value, `${prop}: ${value}`).not.toMatch(LITERAL);
      if (COLOURED.test(prop)) expect(ownColours(value), `${prop}: ${value}`).toEqual([]);
    }
  });

  it('paper and ink (and every state re-ink) are mixed from the theme tokens only', () => {
    const inks = parse(read('sheet.css')).filter((d) => /^--(paper|ink)(-|$)/.test(d.prop));
    expect(new Set(inks.map((d) => d.prop))).toEqual(new Set(['--paper', '--ink', '--ink-strong', '--ink-dim', '--ink-faint']));
    const allowed = new Set(['--primary', '--background', '--foreground', '--status-success', '--status-pending', '--status-error']);
    for (const { prop, value } of inks) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) expect(allowed, `${prop} reads ${name}`).toContain(name);
    }
  });
});
