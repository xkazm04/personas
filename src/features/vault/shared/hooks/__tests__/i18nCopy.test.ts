import { describe, it, expect } from 'vitest';
import { formatCountdown } from '../useRotationTicker';
import { parseEnvFile, parseDopplerOutput, type ImportParseMessages } from '@/features/vault/sub_credentials/components/import/importHelpers';
import type { Translations } from '@/i18n/en';

// A deliberately non-English catalog: if a literal leaks through, these fail.
const RS = {
  countdown_due_now: 'ZZ-due',
  countdown_days_hours: '{days}D/{hours}H',
  countdown_hours_minutes: '{hours}H/{minutes}M',
  countdown_minutes: '{minutes}M',
} as unknown as Translations['vault']['rotation_section']; // test fixture: only the four countdown_* leaves are read

const MSG = {
  err_env_missing_separator: 'ZZ line {line}',
  err_doppler_parse_failed: 'ZZ doppler',
} as unknown as ImportParseMessages; // test fixture: only the leaves exercised below are read

describe('vault copy is looked up, not hardcoded', () => {
  it('formatCountdown renders every branch from the supplied catalog', () => {
    const at = (s: number) => new Date(Date.now() + s * 1000 + 500).toISOString();
    expect(formatCountdown(at(-5), RS)).toBe('ZZ-due');
    expect(formatCountdown(at(2 * 86400 + 3 * 3600), RS)).toBe('2D/3H');
    expect(formatCountdown(at(3600 + 5 * 60), RS)).toBe('1H/5M');
    expect(formatCountdown(at(7 * 60), RS)).toBe('7M');
    expect(formatCountdown(null, RS)).toBeNull();
  });

  it('parser errors come from the supplied catalog', () => {
    expect(parseEnvFile('\nNOEQUALS', MSG).errors).toEqual(['ZZ line 2']);
    expect(parseDopplerOutput('{not json', MSG).errors).toEqual(['ZZ doppler']);
  });
});
