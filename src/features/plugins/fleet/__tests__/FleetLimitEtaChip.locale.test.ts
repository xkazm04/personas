/**
 * The limit-reset clock is read in the app's language, not the host OS's.
 * It used to call toLocaleTimeString(undefined, ...): an operator who set the
 * app to German on an en-US laptop read "07:50 PM", and one who set English on
 * a German laptop read "19:50". Both assertions below run so that, whatever
 * the host locale of the machine running this test, the old behaviour fails one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatResetClock } from '../FleetLimitEtaChip';

const at = new Date(2026, 9, 18, 19, 50).getTime();

describe('formatResetClock', () => {
  it('renders a 12-hour clock for an English operator', () => {
    expect(formatResetClock(at, 'en-US')).toMatch(/07:50\s?PM/i);
  });

  it('renders a 24-hour clock for a German operator', () => {
    expect(formatResetClock(at, 'de')).toBe('19:50');
  });

  it('the chip passes the app language, never undefined', () => {
    const src = readFileSync(join(__dirname, '..', 'FleetLimitEtaChip.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/formatResetClock\(at, language\)/);
    expect(src).not.toMatch(/toLocaleTimeString\(\s*undefined/);
  });
});
