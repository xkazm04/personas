import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SimulationPanel fills `{personaPlural}` with the ENGLISH plural suffix 's'
 * (and the high-severity sentence only renders at 3+ personas, so it is always
 * 's'). Thirteen translations had kept the placeholder, so every one of them
 * rendered a stray Latin "s" after its own noun ("3 个智能体s", "3 personus").
 * The suffix belongs to English only.
 */
const LOCALES_DIR = resolve(__dirname, '../../../../i18n/locales');

describe('vault.dependencies.sim_high', () => {
  const locales = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json') && f !== 'en.json');

  it('reads every non-English catalog', () => {
    expect(locales.length).toBe(13);
  });

  it.each(locales)('%s carries no English plural suffix slot', (file) => {
    const catalog = JSON.parse(readFileSync(resolve(LOCALES_DIR, file), 'utf8'));
    const copy: string = catalog.vault.dependencies.sim_high;
    expect(copy).toContain('{personas}');
    expect(copy).not.toContain('{personaPlural}');
  });
});
