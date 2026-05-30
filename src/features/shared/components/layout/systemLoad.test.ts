import { describe, it, expect } from 'vitest';
import { ema, nextLoadLevel, type LoadLevel } from './systemLoad';

describe('ema', () => {
  it('seeds with the first sample when prev is null', () => {
    expect(ema(null, 42)).toBe(42);
  });
  it('damps toward the new sample by alpha', () => {
    // 0.25*100 + 0.75*0 = 25
    expect(ema(0, 100, 0.25)).toBeCloseTo(25, 6);
  });
  it('a single spike barely moves a settled average', () => {
    expect(ema(20, 100, 0.25)).toBeCloseTo(40, 6); // not 100 — spike is damped
  });
});

describe('nextLoadLevel — entering worse levels (CPU)', () => {
  it('green → red on a high CPU spike', () => {
    expect(nextLoadLevel('green', 90, 30)).toBe('red');
  });
  it('green → amber on moderate CPU', () => {
    expect(nextLoadLevel('green', 75, 30)).toBe('amber');
  });
  it('stays green when comfortably idle', () => {
    expect(nextLoadLevel('green', 40, 50)).toBe('green');
  });
});

describe('nextLoadLevel — memory drives the level independently', () => {
  it('green → red when RAM is nearly exhausted', () => {
    expect(nextLoadLevel('green', 20, 92)).toBe('red');
  });
  it('green → amber when RAM is tightening', () => {
    expect(nextLoadLevel('green', 20, 80)).toBe('amber');
  });
});

describe('nextLoadLevel — hysteresis prevents flicker', () => {
  it('holds red while still in the red band (CPU 82, between exit 80 and enter 88)', () => {
    expect(nextLoadLevel('red', 82, 30)).toBe('red');
  });
  it('steps red → amber once CPU drops below the red-exit threshold', () => {
    expect(nextLoadLevel('red', 78, 30)).toBe('amber');
  });
  it('holds amber while in the amber band (CPU 66, between exit 64 and enter 72)', () => {
    expect(nextLoadLevel('amber', 66, 30)).toBe('amber');
  });
  it('steps amber → green only once clearly calm', () => {
    expect(nextLoadLevel('amber', 60, 50)).toBe('green');
  });
  it('a green-state machine does NOT hold amber (no spurious upgrade)', () => {
    // prev green, cpu 66 is below the amber ENTER (72) — must stay green
    expect(nextLoadLevel('green', 66, 50)).toBe('green');
  });
});

describe('nextLoadLevel — a realistic descent is monotone and stable', () => {
  it('red → amber → green as load eases, without bouncing', () => {
    let level: LoadLevel = 'red';
    const trace: LoadLevel[] = [];
    for (const cpu of [90, 82, 76, 66, 60, 40]) {
      level = nextLoadLevel(level, cpu, 30);
      trace.push(level);
    }
    expect(trace).toEqual(['red', 'red', 'amber', 'amber', 'green', 'green']);
  });
});
