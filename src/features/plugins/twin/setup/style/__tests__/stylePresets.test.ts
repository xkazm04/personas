import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import { STYLE_PRESETS } from '../stylePresets';
import { STYLE_DIMENSIONS, type StylePresetId } from '../styleContract';
import { MAX_EXTREMES, dimsKey, extremeCount, violatesPairRules } from '../styleDims';

/** Every id the `StylePresetId` union declares; `satisfies` fails to compile on drift. */
const DECLARED_IDS = [
  'executive-brief',
  'polished-professional',
  'consultative-expert',
  'plainspoken-direct',
  'warm-helpful',
  'friendly-casual',
  'empathic-listener',
  'upbeat-cheerleader',
  'witty-wry',
  'close-informal',
] as const satisfies readonly StylePresetId[];

/**
 * Presets that sit at more extremes than the rolled-style rule allows, BY
 * DESIGN (the decided catalog): a terse ceremonial brief and a loose intimate
 * register are extremes by definition. Two-sided: a preset leaving this list,
 * or a new one joining it, fails.
 */
const CURATED_EXTREME_EXCEPTIONS: Record<string, number> = {
  'executive-brief': 5,
  'close-informal': 4,
};

describe('STYLE_PRESETS catalog', () => {
  it('has exactly the 10 declared ids, each once', () => {
    const ids = STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(10);
    expect([...ids].sort()).toEqual([...DECLARED_IDS].sort());
  });

  it('gives every dimension an integer 1..5', () => {
    for (const preset of STYLE_PRESETS) {
      expect(Object.keys(preset.dims).sort()).toEqual([...STYLE_DIMENSIONS].sort());
      for (const dim of STYLE_DIMENSIONS) {
        const v = preset.dims[dim];
        expect(Number.isInteger(v), `${preset.id}.${dim}`).toBe(true);
        expect(v >= 1 && v <= 5, `${preset.id}.${dim}=${v}`).toBe(true);
      }
    }
  });

  it('breaks neither contradictory pair', () => {
    for (const preset of STYLE_PRESETS) {
      expect(violatesPairRules(preset.dims), preset.id).toBe(false);
    }
  });

  it('keeps to the extremes budget except the named curated exceptions', () => {
    const over: Record<string, number> = {};
    for (const preset of STYLE_PRESETS) {
      const n = extremeCount(preset.dims);
      if (n > MAX_EXTREMES) over[preset.id] = n;
    }
    expect(over).toEqual(CURATED_EXTREME_EXCEPTIONS);
  });

  it('has pairwise distinct dimension vectors', () => {
    const keys = STYLE_PRESETS.map((p) => dimsKey(p.dims));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has name, summary, avoid and sample copy for every preset in en.json', () => {
    const presets = en.twin.style.presets as Record<string, Record<string, string>>;
    for (const preset of STYLE_PRESETS) {
      for (const field of ['name', 'summary', 'avoid', 'sample']) {
        const value = presets[preset.id]?.[field];
        expect(typeof value === 'string' && value.trim().length > 0, `${preset.id}.${field}`).toBe(true);
      }
      expect(presets[preset.id].avoid.startsWith('Never'), `${preset.id}.avoid`).toBe(true);
    }
  });

  it('has a label and five level words for every dimension in en.json', () => {
    const dims = en.twin.style.dims as Record<string, Record<string, string>>;
    for (const dim of STYLE_DIMENSIONS) {
      for (const key of ['label', 'l1', 'l2', 'l3', 'l4', 'l5']) {
        expect(dims[dim]?.[key], `${dim}.${key}`).toBeTruthy();
      }
    }
  });
});
