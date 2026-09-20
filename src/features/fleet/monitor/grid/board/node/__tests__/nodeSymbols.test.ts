// nodeSymbols — the map every board reads, and the three styles as data.
//
// Two contracts. (1) WHICH symbols show, in WHICH order, is one pure function
// per kind, so a symbol that leaks (a rank on a live row, an origin on a
// persona) or an order that drifts between boards fails here, without a DOM.
// (2) The tint and border tables are literal (Tailwind must see the class
// verbatim), so they are tied to the canonical `FLEET_STATE_META[].dot` by
// hue FAMILY — the same lockstep `SESSION_BORDER` has — and a palette change
// fails a test instead of drifting.

import { describe, it, expect } from 'vitest';
import { FLEET_STATE_META } from '@/features/plugins/fleet/fleetStateMeta';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL } from '../../../fleetGridModel';
import {
  frameClass, NODE_STYLE, NODE_SYMBOL_ORDER, ORIGIN_GLYPH, PERSONA_HUE, PERSONA_STATE_MARK, personaSymbols,
  SESSION_STATE_MARK, SESSION_TINT, sessionHue, sessionSymbols, swatchHue, swatchInitial, symbolClass,
} from '../nodeSymbols';

/** `bg-blue-400` → `blue`; `bg-primary` → `primary`; `bg-foreground/30` → `foreground`. */
const family = (cls: string) => cls.replace(/^(bg|border|text)-/, '').split(/[-/[]/)[0];

describe('the session symbol list', () => {
  it('shows state · origin · elapsed · project for a running row, and never a rank or a gate', () => {
    expect(sessionSymbols({ state: 'running', elapsedFill: 0.4, rank: null, gated: false, projectLabel: 'pumper' }))
      .toEqual(['state', 'origin', 'elapsed', 'project']);
  });

  it('shows state · origin · rank · gate · elapsed · project for a gated queued row', () => {
    expect(sessionSymbols({ state: 'queued', elapsedFill: 0.9, rank: 3, gated: true, projectLabel: 'pumper' }))
      .toEqual(['state', 'origin', 'rank', 'gate', 'elapsed', 'project']);
  });

  it('drops the gate once the earliest start has passed, and the rank while the snapshot lags', () => {
    expect(sessionSymbols({ state: 'queued', elapsedFill: null, rank: null, gated: false, projectLabel: null }))
      .toEqual(['state', 'origin']);
  });

  it('draws no elapsed ring without a denominator, and none for a parked or done row', () => {
    expect(sessionSymbols({ state: 'running', elapsedFill: null, rank: null, gated: false, projectLabel: null }))
      .toEqual(['state', 'origin']);
    for (const state of ['idle', 'stale', 'finished', 'hibernated', 'exited', 'awaiting_input', 'spawning'] as const) {
      expect(sessionSymbols({ state, elapsedFill: 0.5, rank: null, gated: false, projectLabel: null })).toEqual(['state', 'origin']);
    }
  });

  it('never shows a persona symbol', () => {
    const ids = sessionSymbols({ state: 'queued', elapsedFill: 0.5, rank: 1, gated: true, projectLabel: 'x' });
    for (const id of ['team', 'unseen', 'queued', 'operation', 'off']) expect(ids).not.toContain(id);
  });
});

describe('the persona symbol list', () => {
  it('shows state · off · team · operation · unseen · queued when everything is on', () => {
    expect(personaSymbols({ off: true, teamName: 'pumper', unseenChat: 2, queued: 1, operation: true }))
      .toEqual(['state', 'off', 'team', 'operation', 'unseen', 'queued']);
  });

  it('is the state alone for a resting tray persona', () => {
    expect(personaSymbols({ off: false, teamName: null, unseenChat: 0, queued: 0, operation: false })).toEqual(['state']);
  });

  it('never shows a session symbol', () => {
    const ids = personaSymbols({ off: true, teamName: 'x', unseenChat: 9, queued: 9, operation: true });
    for (const id of ['origin', 'rank', 'gate', 'elapsed', 'project']) expect(ids).not.toContain(id);
  });

  it('follows the ONE order whatever order the inputs arrive in', () => {
    const ids = personaSymbols({ off: true, teamName: 'x', unseenChat: 1, queued: 1, operation: true });
    expect(ids).toEqual(NODE_SYMBOL_ORDER.filter((id) => ids.includes(id)));
  });
});

describe('the state and origin marks', () => {
  it('cover every session state and every persona state', () => {
    expect(Object.keys(SESSION_STATE_MARK).sort()).toEqual(FLEET_STATE_META.map((m) => m.id).sort());
    expect(Object.keys(PERSONA_STATE_MARK).sort()).toEqual([...SQUARE_STATE_ORDER].sort());
  });

  it('pulse for running, hollow for idle, an icon for everything else', () => {
    expect(SESSION_STATE_MARK.running.kind).toBe('pulse');
    expect(SESSION_STATE_MARK.idle.kind).toBe('hollow');
    expect(PERSONA_STATE_MARK.running.kind).toBe('pulse');
    expect(PERSONA_STATE_MARK.idle.kind).toBe('hollow');
    for (const s of ['awaiting_input', 'stale', 'queued', 'finished', 'hibernated', 'exited', 'spawning'] as const) {
      expect(SESSION_STATE_MARK[s].kind).toBe('icon');
    }
  });

  it('gives every origin a distinct glyph', () => {
    const glyphs = Object.values(ORIGIN_GLYPH);
    expect(glyphs).toHaveLength(8);
    expect(new Set(glyphs).size).toBe(8);
  });
});

describe('the hue tables', () => {
  it('SESSION_TINT stays in lockstep with the canonical FLEET_STATE_META palette', () => {
    for (const meta of FLEET_STATE_META) {
      expect(family(SESSION_TINT[meta.id])).toBe(family(meta.dot));
      expect(SESSION_TINT[meta.id]).toMatch(/\/\[0\.08\]$/);
    }
    expect(Object.keys(SESSION_TINT).sort()).toEqual(FLEET_STATE_META.map((m) => m.id).sort());
  });

  it('sessionHue reads text and dot from the canonical table', () => {
    const meta = FLEET_STATE_META.find((m) => m.id === 'awaiting_input')!;
    expect(sessionHue('awaiting_input')).toMatchObject({ text: meta.text, dot: meta.dot, border: 'border-violet-400' });
  });

  it('PERSONA_HUE stays in the same family as SQUARE_VISUAL\'s accent, per state', () => {
    for (const st of SQUARE_STATE_ORDER) {
      const fam = family(SQUARE_VISUAL[st].accent);
      expect(family(PERSONA_HUE[st].dot)).toBe(fam);
      if (st !== 'idle') {
        expect(family(PERSONA_HUE[st].border)).toBe(fam);
        expect(family(PERSONA_HUE[st].tint)).toBe(fam);
      }
    }
  });
});

describe('the three styles', () => {
  const hue = sessionHue('running');

  it('yield three DISTINCT frames for the same hue', () => {
    const frames = (['outline', 'accent', 'tinted'] as const).map((s) => frameClass(s, hue));
    expect(new Set(frames).size).toBe(3);
    expect(frames[0]).toContain('border-blue-400');
    expect(frames[0]).toContain('bg-transparent');
    expect(frames[1]).toContain('border-l-[3px]');
    expect(frames[1]).toContain('border-blue-400');
    expect(frames[2]).toContain('bg-blue-500/[0.08]');
    expect(frames[2]).not.toMatch(/border/);
    expect(frames[2]).toContain('shadow-elevation-1');
  });

  it('dash the frame for a queued row only where there is a border', () => {
    expect(frameClass('outline', hue, { queued: true })).toContain('border-dashed');
    expect(frameClass('accent', hue, { queued: true })).toContain('border-dashed');
    expect(frameClass('tinted', hue, { queued: true })).not.toContain('border-dashed');
  });

  it('put the hue on the state symbol only in outline, in chips in accent, on solid circles in tinted', () => {
    expect(symbolClass('outline', hue, true)).toBe(hue.text);
    expect(symbolClass('outline', hue, false)).toBe('text-foreground opacity-70');
    expect(symbolClass('accent', hue, true)).toContain('bg-secondary/40');
    expect(symbolClass('accent', hue, true)).toContain(hue.text);
    expect(symbolClass('accent', hue, false)).toBe('rounded-full bg-secondary/40 text-foreground');
    expect(symbolClass('tinted', hue, true)).toBe(`rounded-full ${hue.dot} text-background`);
    expect(symbolClass('tinted', hue, false)).toBe(`rounded-full ${hue.dot} text-background`);
  });

  it('differ in frame, hue application and symbol treatment — never in which symbols show', () => {
    expect(NODE_STYLE.outline.elapsed).toBe('ring');
    expect(NODE_STYLE.accent.elapsed).toBe('ring');
    expect(NODE_STYLE.tinted.elapsed).toBe('bar');
    expect(NODE_STYLE.accent.title).toBe('font-medium');
    expect(new Set(Object.values(NODE_STYLE).map((s) => s.symbolTone)).size).toBe(3);
  });
});

describe('the swatch', () => {
  it('hashes the same name to the same hue, in range', () => {
    expect(swatchHue('pumper')).toBe(swatchHue('pumper'));
    expect(swatchHue('pumper')).not.toBe(swatchHue('politicas'));
    for (const n of ['a', 'pumper', 'a very long project name with spaces', '']) {
      expect(swatchHue(n)).toBeGreaterThanOrEqual(0);
      expect(swatchHue(n)).toBeLessThan(360);
    }
  });

  it('takes the first letter or digit, upper-cased, and never renders empty', () => {
    expect(swatchInitial('pumper')).toBe('P');
    expect(swatchInitial('  3d-lab')).toBe('3');
    expect(swatchInitial('— politicas')).toBe('P');
    expect(swatchInitial('')).toBe('·');
  });
});
