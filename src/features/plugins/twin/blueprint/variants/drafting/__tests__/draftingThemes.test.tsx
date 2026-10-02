/**
 * The drafting sheet's theme levels (spark twin-portable-blueprint; round 3
 * WP-D reworked round 2's versions): `draftingTint` ("Personas touch"),
 * `draftingSurface` ("Half and half") and `draftingNative` ("Personas
 * blueprint") are ONE renderer with a `theme`, and the baseline is untouched.
 * Asserted on the DOM the levels render and on their stylesheets, never on
 * pixels:
 *
 * - each id renders its own level in L1, every L2 and the stage, and keeps
 *   the contract's behaviour (section controls, "not measured" states,
 *   reduced motion);
 * - the blueprint is kept in every level: the drafting grid and the drawn
 *   sheet border; levels 1 and 2 carry the cyanotype blue, level 3 none
 *   (computed from the real stylesheets);
 * - every colour the stylesheets declare is mixed from the app's tokens,
 *   except the one documented cyanotype anchor;
 * - what each level changes in the drawing's structure, and where that puts
 *   the parts in the draw-in (the schedule's invariants for every theme are in
 *   drawSchedule.test.tsx).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import { FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH } from '../../../__fixtures__/blueprintFixtures';
import DraftingBlueprint from '../index';
import DraftingNative from '../themes/native';
import DraftingSurface from '../themes/surface';
import DraftingTint from '../themes/tint';

type Version = [id: string, Component: ComponentType<BlueprintVariantProps>, theme: string];
const VERSIONS: Version[] = [
  ['draftingTint', DraftingTint, 'tint'],
  ['draftingSurface', DraftingSurface, 'surface'],
  ['draftingNative', DraftingNative, 'native'],
];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];
const FIXTURES: Array<[string, TwinBlueprintModel]> = [['empty', FIXTURE_EMPTY], ['one channel', FIXTURE_ONE_CHANNEL], ['rich', FIXTURE_RICH]];

function props(over: Partial<BlueprintVariantProps> = {}): BlueprintVariantProps {
  return { model: FIXTURE_RICH, mode: 'detail', focus: null, onFocus: vi.fn(), onOpenDetail: vi.fn(), delta: null, working: false, reduced: false, ...over };
}
const root = () => screen.getByTestId('twin-blueprint-drafting');
const drawing = () => document.querySelector('[data-draw-root][data-draw-state="drawing"]')!;
const at = (el: Element | null | undefined) => Number(el?.getAttribute('data-draw-at'));
const depth = (el: Element | null | undefined) => el?.getAttribute('data-draw-depth');
/** The content one container writes, in order. */
const kindsIn = (scope: Element) =>
  Array.from(scope.querySelectorAll('[data-draw-at]'))
    .filter((el) => !el.hasAttribute('data-draw-depth') && el.parentElement?.closest('[data-draw-scope]') === scope)
    .sort((a, b) => at(a) - at(b))
    .map((el) => el.getAttribute('data-draw'));

describe.each(VERSIONS)('%s renders its own version', (_id, Version, theme) => {
  it.each(FIXTURES)('%s: L1, every L2 and the stage, on no cyanotype paper', (_name, model) => {
    const views = [
      { over: { model }, check: () => SECTIONS.forEach((s) => expect(screen.getByTestId(`twd-region-${s}`)).toBeInTheDocument()) },
      ...SECTIONS.map((focus) => ({ over: { model, focus }, check: () => expect(screen.getByTestId(`twd-focus-${focus}`)).toBeInTheDocument() })),
      { over: { model, mode: 'stage' as const, delta: FIXTURE_DELTA_RECONCILED }, check: () => expect(screen.getByTestId('twd-notes')).toBeInTheDocument() },
    ];
    for (const v of views) {
      const view = render(<Version {...props(v.over)} />);
      expect(root()).toHaveAttribute('data-drafting-theme', theme);
      // Studio's cyanotype root (and its anchored paper and ink) is nowhere in the tree.
      expect(root()).not.toHaveClass('drafting-root');
      expect(document.querySelector('.drafting-root')).toBeNull();
      v.check();
      view.unmount();
    }
  });

  it('the regions stay the section controls, and the stage regions stay drawings', () => {
    const l1 = render(<Version {...props()} />);
    for (const s of ['Identity', 'Voice', 'Knowledge', 'Training']) expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    l1.unmount();
    render(<Version {...props({ mode: 'stage' })} />);
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`)).not.toHaveAttribute('role');
  });

  it('"not measured" is still hatched or a dash, never a zero', () => {
    const model: TwinBlueprintModel = {
      ...FIXTURE_ONE_CHANNEL,
      identity: { ...FIXTURE_ONE_CHANNEL.identity, bioChars: null },
      knowledge: { memories: { approved: null, pending: null, rejected: null }, facts: null, kbBound: false },
      samples: { open: null },
    };
    const l1 = render(<Version {...props({ model })} />);
    expect(screen.getByTestId('twd-region-knowledge')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('twd-region-knowledge').querySelector('[data-measured="false"]')).not.toBeNull();
    expect(screen.getByTestId('twd-region-identity').querySelector('[data-measured="false"]')).not.toBeNull();
    l1.unmount();
    render(<Version {...props({ model, focus: 'knowledge' })} />);
    expect(within(screen.getByTestId('twd-focus-knowledge')).getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  it('reduced motion draws it at once: no schedule, no lettering, no pen', () => {
    render(<Version {...props({ mode: 'stage', working: true, reduced: true })} />);
    for (const r of document.querySelectorAll('[data-draw-root]')) expect(r).toHaveAttribute('data-draw-state', 'instant');
    expect(document.querySelectorAll('[data-draw-at], [data-loop-at], [data-ch]')).toHaveLength(0);
    expect(screen.queryByTestId('twd-pen')).toBeNull();
  });
});

describe('the baseline is unchanged', () => {
  it('cyanotype paper, the drawn border, pencil regions, balloons and drafting lettering', () => {
    render(<DraftingBlueprint {...props()} />);
    expect(root()).toHaveClass('drafting-root');
    expect(root()).toHaveAttribute('data-drafting-theme', 'cyanotype');
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();
    expect(document.querySelector('.twd-card')).toBeNull();
    const voice = screen.getByTestId('twd-region-voice');
    expect(voice.querySelector(':scope > svg[data-draw-svg="outline"] rect[stroke-dasharray="5 4"]')).not.toBeNull();
    expect(kindsIn(voice).slice(0, 6)).toEqual(['stroke', 'rise', 'write', 'write', 'write', 'ink']);
    expect(document.querySelector('.typo-eyebrow')).toBeNull();
  });
});

describe('what each level changes, and where it lands in the draw-in', () => {
  it('tint: the same sheet, drawing and lettering; only its paper, ink, accent and edge change (CSS)', () => {
    render(<DraftingTint {...props()} />);
    const frames = Array.from(drawing().querySelectorAll('[data-draw-depth="0"]'));
    // The border, four regions and the title block, exactly as on the cyanotype.
    expect(frames).toHaveLength(6);
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();
    expect(kindsIn(screen.getByTestId('twd-region-voice')).slice(0, 6)).toEqual(['stroke', 'rise', 'write', 'write', 'write', 'ink']);
    expect(document.querySelector('.twd-card, .typo-eyebrow')).toBeNull();
  });

  it.each([['surface', DraftingSurface], ['native', DraftingNative]] as const)(
    '%s: the sheet and its border stay; every region and the title block is a card laid on it, framed first and filled with the next wave',
    (theme, Version) => {
      render(<Version {...props()} />);
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
      // Section names are the app's titles from level 2 on.
      for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`).querySelector('header .typo-title')).not.toBeNull();
      if (theme === 'surface') {
        // Labels keep the drafting lettering (spaced capitals), never the app's eyebrows.
        expect(document.querySelector('.typo-eyebrow')).toBeNull();
        expect(document.querySelectorAll('[style*="letter-spacing: 0.1em"]').length).toBeGreaterThan(5);
      } else {
        // Personas has taken the type: eyebrows, never the lettering's spaced capitals.
        expect(document.querySelectorAll('.typo-eyebrow').length).toBeGreaterThan(5);
        expect(document.querySelector('[style*="letter-spacing: 0.1em"]')).toBeNull();
      }
    },
  );

  it('surface: a region writes its balloon, its name, its share, then runs its ink round the card', () => {
    render(<DraftingSurface {...props()} />);
    expect(kindsIn(screen.getByTestId('twd-region-voice')).slice(0, 6)).toEqual(['stroke', 'rise', 'write', 'write', 'write', 'ink']);
    // Readiness is still pressed last.
    const stamp = document.querySelector('.twd-stamp')!;
    expect(stamp).toHaveAttribute('data-draw', 'press');
    const ends = Array.from(drawing().querySelectorAll('[data-draw-at]:not([data-draw="press"])')).map((el) => at(el) + Number(el.getAttribute('data-draw-for')));
    expect(at(stamp)).toBeGreaterThanOrEqual(Math.max(...ends));
  });

  it('native: an icon chip names each section; the brand glyph is traced on the title card; status in the app roles', () => {
    render(<DraftingNative {...props()} />);
    const voice = screen.getByTestId('twd-region-voice');
    expect(voice.querySelector('[data-section-icon="voice"]')).not.toBeNull();
    expect(kindsIn(voice).slice(0, 6)).toEqual(['stroke', 'rise', 'mark', 'write', 'write', 'ink']);
    // The twin's brand glyph: its two profiles traced stroke by stroke.
    const mark = screen.getByTestId('twd-title-block').querySelector('[data-section-icon="identity"]')!;
    expect(mark.querySelectorAll('path[data-draw="stroke"]')).toHaveLength(2);
    // Readiness: a ring inked to the score, its figure pressed last; the slots in the twin status roles.
    expect(screen.getByTestId('twd-title-block').querySelector('.twd-ring')).toHaveAttribute('data-draw', 'ink');
    expect(document.querySelectorAll('[data-slot] .k-dot.t-success.g-solid')).toHaveLength(4);
    // Layer one's memories as one composition bar in the status roles; the zoom keeps the tallies.
    const knowledge = screen.getByTestId('twd-region-knowledge');
    expect(knowledge.querySelector('[data-tally]')).toBeNull();
    expect(knowledge.querySelectorAll('[data-part]').length).toBeGreaterThan(0);
  });

  it('native: the zoom keeps the tallies (the counting signature)', () => {
    render(<DraftingNative {...props({ focus: 'knowledge' })} />);
    expect(screen.getByTestId('twd-focus-knowledge').querySelectorAll('[data-tally]').length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The levels' real stylesheets, injected into the document so jsdom cascades
 * them onto the rendered root (it resolves custom properties to their declared
 * text, which is what is asserted: what each value is MADE of).
 */
const THEMES_DIR = resolve(process.cwd(), 'src/features/plugins/twin/blueprint/variants/drafting/themes');
const STYLESHEETS: Record<string, string[]> = {
  tint: ['sheet.css', 'cyanotype.css', 'tint.css'],
  surface: ['sheet.css', 'cyanotype.css', 'surface.css'],
  native: ['sheet.css', 'native.css'],
};

describe.each(VERSIONS)('%s keeps the blueprint (computed from its stylesheets)', (_id, Version, theme) => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = STYLESHEETS[theme]!.map((f) => readFileSync(resolve(THEMES_DIR, f), 'utf8')).join('\n');
    document.head.appendChild(style);
  });
  afterEach(() => {
    style.remove();
    document.documentElement.removeAttribute('data-theme');
  });

  it.each([['dark', null], ['light', 'light']] as const)('%s theme: the drafting grid, the sheet border, and the cyanotype only below level 3', (_mode, dataTheme) => {
    if (dataTheme) document.documentElement.setAttribute('data-theme', dataTheme);
    render(<Version {...props()} />);
    const cs = getComputedStyle(root());
    // The 80/16 px drafting grid, drawn from the level's own grid inks.
    expect(cs.backgroundSize).toContain('80px 80px, 80px 80px, 16px 16px, 16px 16px');
    expect(cs.backgroundImage.match(/linear-gradient\((?:90deg, )?var\(--grid-(?:major|fine)\) 1px, transparent 1px\)/g)).toHaveLength(4);
    expect(cs.getPropertyValue('--grid-major').trim()).not.toBe('');
    expect(cs.getPropertyValue('--grid-fine').trim()).not.toBe('');
    expect(cs.backgroundColor).toBe('var(--paper)');
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();

    const cyanotype = cs.getPropertyValue('--twd-cyanotype').trim();
    const paper = cs.getPropertyValue('--paper');
    const ink = cs.getPropertyValue('--ink');
    if (theme === 'native') {
      // No foreign blue: the paper and the ink are the theme's own.
      expect(cyanotype).toBe('');
      expect(`${paper} ${ink}`).not.toMatch(/--twd-cyan/);
      expect(paper).toContain('--primary');
      expect(ink).toContain('--primary');
    } else {
      expect(cyanotype).toMatch(/^#[0-9a-f]{6}$/i);
      if (theme === 'tint') {
        // The cyanotype intact: its paper and ink alone, in every theme.
        expect(paper.trim()).toBe('var(--twd-cyan-paper)');
        expect(ink.trim()).toBe('var(--twd-cyan-ink)');
      } else {
        // Half and half: the cyanotype's paper mixed with the theme's.
        expect(paper).toMatch(/--twd-cyan-paper/);
        expect(paper).toMatch(/--twd-theme-paper/);
        expect(ink).toMatch(/--twd-cyan-(?:ink|paper)/);
        expect(ink).toMatch(/--twd-theme-ink/);
      }
    }
  });
});

/**
 * The levels' stylesheets, read as text: every value is mixed from the app's
 * tokens, except the one documented cyanotype anchor. Stripped of comments,
 * `var(--*)`, numbers with units, the colour and gradient functions and their
 * keywords, a declaration has nothing left that could name a colour.
 */
describe('the levels name no colour of their own but the cyanotype anchor', () => {
  const SHEETS = ['sheet.css', 'cyanotype.css', 'tint.css', 'surface.css', 'native.css'];
  const KEYWORDS = new Set([
    'color-mix', 'in', 'srgb', 'oklab', 'transparent', 'currentColor', 'none', 'linear-gradient', 'radial-gradient', 'drop-shadow',
    'at', 'deg', 'inset', 'solid', 'ease-out', 'isolate', 'calc', 'box-shadow', 'black', 'white',
  ]);
  /** Every `prop: value;` in a stylesheet, however deeply its rule is nested (`@container`). */
  const parse = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value!.trim() }));
  /** Properties that can carry a colour; custom properties always can. */
  const COLOURED = /^(--|background|color|border|box-shadow|fill|stroke|filter|outline|text-shadow|caret-color|accent-color|column-rule)/;
  const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|--drafting-blue/i;
  const declarations = (file: string) => parse(readFileSync(resolve(THEMES_DIR, file), 'utf8'));
  /** The anchor: the cyanotype blue, declared once. */
  const isAnchor = (file: string, prop: string) => file === 'cyanotype.css' && prop === '--twd-cyanotype';
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

  it('the check itself finds a planted literal, a named colour and the studio anchor', () => {
    const planted = parse('.x { --ink: color-mix(in srgb, var(--primary) 70%, #7fd3f7); color: blue; --paper: var(--drafting-blue); }');
    const [hex, named, anchor] = planted.map((d) => ownColours(d.value));
    expect(hex).toContain('#7fd3f7');
    expect(named).toEqual(['blue']);
    expect(anchor).toEqual(['--drafting-blue']);
  });

  it.each(SHEETS)('%s names no colour of its own', (file) => {
    const found = declarations(file);
    expect(found.length).toBeGreaterThan(3);
    for (const { prop, value } of found) {
      if (isAnchor(file, prop)) continue;
      expect(value, `${prop}: ${value}`).not.toMatch(LITERAL);
      if (COLOURED.test(prop)) expect(ownColours(value), `${prop}: ${value}`).toEqual([]);
    }
  });

  it('the cyanotype is ONE anchor, declared once, and only levels 1 and 2 read it', () => {
    const anchors = SHEETS.flatMap((f) => declarations(f).filter((d) => LITERAL.test(d.value)).map((d) => `${f} ${d.prop}`));
    expect(anchors).toEqual(['cyanotype.css --twd-cyanotype']);
    expect(readFileSync(resolve(THEMES_DIR, 'native.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/--twd-cyan/);
  });

  it.each([
    ['tint.css', ['--paper', '--paper-deep', '--ink', '--ink-strong', '--ink-dim', '--ink-faint']],
    ['surface.css', ['--paper', '--ink', '--ink-strong', '--ink-dim', '--ink-faint']],
    ['native.css', ['--paper', '--ink', '--ink-strong', '--ink-dim', '--ink-faint']],
  ])('%s draws its paper and ink (and re-inks its states) from the cyanotype and the theme tokens only', (file, inkProps) => {
    const inks = declarations(file).filter((d) => /^--(paper|ink)(-|$)/.test(d.prop));
    expect(new Set(inks.map((d) => d.prop))).toEqual(new Set(inkProps));
    const allowed = new Set(['--primary', '--background', '--foreground', '--card-bg', '--ink', '--twd-cyan-paper', '--twd-cyan-ink', '--twd-cyan-ink-strong', '--twd-theme-paper', '--twd-theme-ink',
      // State re-inks: level 1's live accent; level 3's status roles.
      '--twd-accent', '--status-success', '--status-pending', '--status-error']);
    for (const { prop, value } of inks) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) expect(allowed, `${prop} reads ${name}`).toContain(name);
    }
  });
});
