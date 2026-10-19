import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRingPhase } from '../OAuthSection';

// useOAuthPolling builds its status line from the ACTIVE locale's
// errors.oauth_consent_opened / errors.oauth_starting. The ring used to look
// for the English phrase "consent page opened", so outside English it stayed on
// the indeterminate "waiting" spin for the whole consent.

const LOCALES_DIR = join(__dirname, '../../../../../../i18n/locales');
const locales = readdirSync(LOCALES_DIR).filter((f) => /^[a-z]{2}\.json$/.test(f));

function errorsOf(file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')).errors;
}

describe('OAuthSection ring phase follows the active locale', () => {
  it('reads all 14 locales', () => {
    expect(locales.length).toBe(14);
  });

  it.each(locales)('%s: the consent-opened line moves the ring to polling', (file) => {
    const errors = errorsOf(file);
    const template = errors.oauth_consent_opened!;
    const message = template.replace('{provider}', 'Google');
    expect(deriveRingPhase(true, { success: false, message }, template)).toBe('polling');
  });

  it.each(locales)('%s: the starting line keeps the ring waiting', (file) => {
    const errors = errorsOf(file);
    const message = errors.oauth_starting!.replace('{provider}', 'Google');
    expect(deriveRingPhase(true, { success: false, message }, errors.oauth_consent_opened!)).toBe('waiting');
  });

  it('success after authorizing ends on success; idle is no ring', () => {
    expect(deriveRingPhase(false, { success: true, message: 'x' }, 'opened {provider}')).toBe('success');
    expect(deriveRingPhase(false, null, 'opened {provider}')).toBeNull();
  });
});
