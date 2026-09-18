import { describe, expect, it } from 'vitest';
import { shiftForChannel, targetsFor } from '../channelShift';
import { isCoherent, violatesPairRules, extremeCount, MAX_EXTREMES } from '../styleDims';
import { STYLE_PRESETS } from '../stylePresets';
import type { TwinStyleDims } from '../styleContract';

const MID: TwinStyleDims = {
  formality: 3, warmth: 3, humor: 3, energy: 3, length: 3, directness: 3, expressiveness: 3, detail: 3,
};

describe('shiftForChannel', () => {
  it('leaves generic unchanged', () => {
    expect(shiftForChannel(MID, 'generic')).toEqual(MID);
  });

  it.each([
    ['email', { formality: 4, expressiveness: 2 }],
    ['slack', { formality: 2 }],
    ['teams', { formality: 2 }],
    ['discord', { formality: 2, expressiveness: 4 }],
    ['telegram', { formality: 2, length: 2 }],
    ['whatsapp', { formality: 2, length: 2 }],
    ['sms', { formality: 2, length: 2, detail: 2 }],
    ['voice', { length: 2, detail: 2, expressiveness: 1 }],
  ])('applies the %s rule', (channel, moved) => {
    expect(shiftForChannel(MID, channel)).toEqual({ ...MID, ...moved });
  });

  it('reads an unknown channel as generic', () => {
    expect(shiftForChannel(MID, 'carrier-pigeon')).toEqual(MID);
  });

  it('matches channel names case-insensitively', () => {
    expect(shiftForChannel(MID, 'Email')).toEqual(shiftForChannel(MID, 'email'));
  });

  it('clamps to 1..5', () => {
    const low = { ...MID, formality: 1, length: 1, detail: 1 };
    expect(shiftForChannel(low, 'sms')).toMatchObject({ formality: 1, length: 1, detail: 1 });
    const high = { ...MID, formality: 5, expressiveness: 1 };
    expect(shiftForChannel(high, 'email')).toMatchObject({ formality: 5, expressiveness: 1 });
  });

  it('fixes an incoherent result by lowering expressiveness first', () => {
    // formality 3 -> 4 on email with expressiveness 5 -> 4: formal + frequent is refused.
    const base = { ...MID, expressiveness: 5 };
    const out = shiftForChannel(base, 'email');
    expect(out.formality).toBe(4);
    expect(out.expressiveness).toBe(3);
    expect(violatesPairRules(out)).toBe(false);
  });

  it('keeps voice free of expressiveness even when coherence needs a fix', () => {
    const out = shiftForChannel(STYLE_PRESETS.find((p) => p.id === 'executive-brief')!.dims, 'voice');
    expect(out.expressiveness).toBe(1);
  });

  it('never makes a preset less coherent than its base, on any channel', () => {
    for (const preset of STYLE_PRESETS) {
      const base = Math.max(MAX_EXTREMES, extremeCount(preset.dims));
      for (const ch of ['generic', 'email', 'slack', 'teams', 'discord', 'telegram', 'whatsapp', 'sms', 'voice']) {
        // Voice's absolute "no emoji" may add one extreme the base did not have.
        const budget = base + (ch === 'voice' && preset.dims.expressiveness !== 1 ? 1 : 0);
        expect(isCoherent(shiftForChannel(preset.dims, ch), budget), `${preset.id}@${ch}`).toBe(true);
      }
    }
  });
});

describe('targetsFor', () => {
  it('returns one target per channel, in order', () => {
    const targets = targetsFor(MID, ['generic', 'email', 'x']);
    expect(targets.map((t) => t.channel)).toEqual(['generic', 'email', 'x']);
    expect(targets[1].dims.formality).toBe(4);
  });
});
