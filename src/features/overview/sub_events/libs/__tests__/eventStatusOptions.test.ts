import { describe, it, expect } from 'vitest';
import { eventStatusOptions } from '../eventStatusOptions';
import { en } from '@/i18n/en';
import type { Translations } from '@/i18n/en';

const t = en as unknown as Translations; // en is the catalog the Translations type is generated from

describe('eventStatusOptions', () => {
  const values = eventStatusOptions(t, 'All').map((o) => o.value);

  it('offers the dominant delivered state', () => {
    expect(values).toContain('delivered');
  });

  it('offers the dead-letter and discarded states the backend writes', () => {
    expect(values).toContain('dead_letter');
    expect(values).toContain('discarded');
  });

  it('offers no status the backend never writes', () => {
    expect(values).not.toContain('processed');
  });

  it('labels every option with a translated string, not the raw token', () => {
    for (const o of eventStatusOptions(t, 'All')) {
      expect(o.label).not.toBe(o.value);
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});
