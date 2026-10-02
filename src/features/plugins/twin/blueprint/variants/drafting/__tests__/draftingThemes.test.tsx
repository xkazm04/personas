/**
 * The drafting sheet's theme versions (spark twin-portable-blueprint, round 2
 * WP-C): `draftingTint`, `draftingSurface` and `draftingNative` are ONE
 * renderer with a `theme`, and the baseline is untouched. Asserted on the DOM
 * the versions render and on their stylesheets, never on pixels:
 *
 * - each id renders its own version in L1, every L2 and the stage, and keeps
 *   the contract's behaviour (section controls, "not measured" states,
 *   reduced motion);
 * - each version is theme-derived end to end: no Studio cyanotype root in its
 *   tree, and every colour its stylesheets declare is mixed from the app's
 *   tokens (no literal, no fixed anchor);
 * - what each version changes in the drawing's structure, and where that puts
 *   the parts in the draw-in (the schedule's invariants for every theme are in
 *   drawSchedule.test.tsx).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
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

describe('what each version changes, and where it lands in the draw-in', () => {
  it('tint: the same sheet, drawing and lettering; only its paper, ink and edge change (CSS)', () => {
    render(<DraftingTint {...props()} />);
    const frames = Array.from(drawing().querySelectorAll('[data-draw-depth="0"]'));
    // The border, four regions and the title block, exactly as on the cyanotype.
    expect(frames).toHaveLength(6);
    expect(document.querySelector('.twd-sheet-border')).not.toBeNull();
    expect(kindsIn(screen.getByTestId('twd-region-voice')).slice(0, 6)).toEqual(['stroke', 'rise', 'write', 'write', 'write', 'ink']);
    expect(document.querySelector('.twd-card, .typo-eyebrow')).toBeNull();
  });

  it.each([['surface', DraftingSurface], ['native', DraftingNative]] as const)(
    '%s: no sheet; every region and the title block is a card, framed first and filled with the next wave',
    (theme, Version) => {
      render(<Version {...props()} />);
      expect(document.querySelector('.twd-sheet-border')).toBeNull();
      const cards = [...SECTIONS.map((s) => screen.getByTestId(`twd-region-${s}`)), screen.getByTestId('twd-title-block')];
      for (const card of cards) {
        expect(card).toHaveClass('twd-card');
        expect(depth(card.querySelector(':scope > svg[data-draw-svg="outline"] [data-draw="frame"]'))).toBe('0');
        const fill = card.querySelector(':scope > .twd-card-fill');
        expect(fill).toHaveAttribute('data-draw-wipe', 'fade');
        expect(depth(fill)).toBe('1');
        // Crop marks, the inked page's drafting accent, are traced with the fill.
        const crops = card.querySelectorAll(':scope > svg.twd-crop [data-draw="frame"]');
        expect(crops).toHaveLength(theme === 'surface' ? 4 : 0);
        crops.forEach((c) => expect(depth(c)).toBe('1'));
      }
      // Five frames stand at depth 0: four regions and the title block.
      expect(drawing().querySelectorAll('[data-draw-depth="0"]')).toHaveLength(5);
      // Labels speak the app's type: eyebrows, never the drafting lettering's spaced capitals.
      expect(document.querySelectorAll('.typo-eyebrow').length).toBeGreaterThan(5);
      expect(document.querySelector('[style*="letter-spacing: 0.1em"]')).toBeNull();
    },
  );

  it('surface: a region writes its name, its share, then runs its ink round the card', () => {
    render(<DraftingSurface {...props()} />);
    expect(kindsIn(screen.getByTestId('twd-region-voice'))).toEqual(['write', 'write', 'ink']);
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
 * The versions' stylesheets, read as text: every value is mixed from the app's
 * tokens. Stripped of comments, `var(--*)`, numbers with units, the colour and
 * gradient functions and their keywords, a declaration has nothing left that
 * could name a colour, so no literal (hex, rgb, a named colour) and no fixed
 * anchor can reach the versions' paper and ink.
 */
describe('the versions are theme-derived end to end', () => {
  const DIR = resolve(process.cwd(), 'src/features/plugins/twin/blueprint/variants/drafting/themes');
  const SHEETS = ['tint.css', 'paperless.css', 'surface.css', 'native.css'];
  const KEYWORDS = new Set([
    'color-mix', 'in', 'srgb', 'transparent', 'currentColor', 'none', 'linear-gradient', 'radial-gradient', 'drop-shadow',
    'at', 'deg', 'inset', 'solid', 'ease-out', 'isolate', 'calc', 'box-shadow',
  ]);
  /** Every `prop: value;` in a stylesheet, however deeply its rule is nested (`@container`). */
  const parse = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value!.trim() }));
  /** Properties that can carry a colour; custom properties always can. */
  const COLOURED = /^(--|background|color|border|box-shadow|fill|stroke|filter|outline|text-shadow|caret-color|accent-color|column-rule)/;
  const declarations = (file: string) => parse(readFileSync(resolve(DIR, file), 'utf8'));
  /** What could name a colour in a value: a literal, an anchor, or any word that is not a token, a number or a known keyword. */
  const ownColours = (value: string): string[] => {
    const literal = value.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|--drafting-blue/gi) ?? [];
    const words = value
      .replace(/var\(--[\w-]+(?:,[^()]*)?\)/g, ' ')
      .replace(/-?\d*\.?\d+(?:px|rem|em|%|deg|ms)?/g, ' ')
      .replace(/[(),/]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !KEYWORDS.has(w));
    return [...literal, ...words];
  };

  it('the check itself finds a planted literal, a named colour and the cyanotype anchor', () => {
    const planted = parse('.x { --ink: color-mix(in srgb, var(--primary) 70%, #7fd3f7); color: blue; --paper: var(--drafting-blue); }');
    const [hex, named, anchor] = planted.map((d) => ownColours(d.value));
    expect(hex).toContain('#7fd3f7');
    expect(named).toEqual(['blue']);
    expect(anchor).toEqual(['--drafting-blue']);
  });

  it.each(SHEETS)('%s names no colour of its own', (file) => {
    const found = declarations(file);
    expect(found.length).toBeGreaterThan(10);
    for (const { prop, value } of found) {
      expect(value, `${prop}: ${value}`).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|--drafting-blue/i);
      if (COLOURED.test(prop)) expect(ownColours(value), `${prop}: ${value}`).toEqual([]);
    }
  });

  it.each(['tint.css', 'surface.css', 'native.css'])('%s draws its own paper and ink from --primary, --background, --foreground and the card', (file) => {
    const inks = declarations(file).filter((d) => /^--(paper|ink)(-|$)/.test(d.prop));
    expect(new Set(inks.map((d) => d.prop))).toEqual(new Set(['--paper', '--ink', '--ink-strong', '--ink-dim', '--ink-faint', ...(file === 'tint.css' ? ['--paper-deep'] : [])]));
    const allowed = new Set(['--primary', '--background', '--foreground', '--card-bg', '--ink', '--status-neutral', '--status-success', '--status-pending', '--status-error']);
    for (const { prop, value } of inks) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) expect(allowed, `${prop} reads ${name}`).toContain(name);
    }
  });
});
