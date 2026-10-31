// @vitest-environment node
/**
 * The English fallback copy says what the translated surface says.
 *
 * `DEFAULT_TRIAGE_COPY` is what `useUnifiedTriage` deals with when no copy is
 * passed, what every adapter test asserts against, and — by its own doc — the
 * source of the `en.json` wording. Nothing compared the two, and they drifted:
 * en.json had its em-dashes rewritten while the fallback kept them.
 *
 * Derived, not listed: the key pairs are read out of `useTriageCopy` itself (the
 * one place that binds a `TriageCopy` field to a `monitor.*` key), so a field
 * added there is checked here without anyone remembering to.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import en from '@/i18n/locales/en.json';
import { DEFAULT_TRIAGE_COPY, type TriageCopy } from '../triageAdapters';

const hookSource = readFileSync(resolve(__dirname, '../useTriageCopy.ts'), 'utf8');
const pairs = [...hookSource.matchAll(/^\s+(\w+): m\.(\w+),$/gm)].map(([, field, key]) => ({
  field: field as keyof TriageCopy,
  key: key as string,
}));
const monitor = (en as { monitor: Record<string, string> }).monitor;

describe('DEFAULT_TRIAGE_COPY agrees with en.json', () => {
  it('reads every TriageCopy field the hook binds', () => {
    // A regex that matched nothing would make the parity check below vacuous.
    expect(pairs.length).toBe(Object.keys(DEFAULT_TRIAGE_COPY).length);
  });

  it('carries the en.json wording for every bound field', () => {
    const drift = pairs
      .filter(({ field, key }) => DEFAULT_TRIAGE_COPY[field] !== monitor[key])
      .map(({ field, key }) => `${field} (monitor.${key})`);
    expect(drift).toEqual([]);
  });
});
