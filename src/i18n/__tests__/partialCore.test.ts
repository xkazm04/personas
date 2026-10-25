/**
 * Partial core (FIRST_PAINT_PARTIAL_SECTIONS, 2026-10-25): for monitor,
 * athena, debt, shared and notepad the build carries only the keys first paint
 * can read; the full section is a lazy chunk. The test setup seeds the full
 * sections for every other spec, so this one loads fresh module instances to
 * see what the app sees before the chunk lands.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function fresh() {
  const gen = await import('../generated/enSectionStrings');
  const sections = await import('../englishSections');
  const translation = await import('../useTranslation');
  return { gen, sections, translation };
}

describe('partial core', () => {
  it('ships the titlebar keys of `monitor` eagerly and not the Monitor itself', async () => {
    const { gen } = await fresh();
    const partial = JSON.parse(gen.EN_PARTIAL_SECTION_STRINGS.monitor!) as Record<string, unknown>;
    // Read by always-mounted chrome (TitleBarDock, FleetActivityStrip).
    for (const key of ['titlebar', 'titlebar_attention', 'titlebar_tooltip', 'strip_aria', 'dc_consumers_badge']) {
      expect(partial, key).toHaveProperty(key);
    }
    const full = (await import('../section-locales/en/monitor.json')).default as Record<string, unknown>;
    expect(Object.keys(partial).length).toBeLessThan(Object.keys(full).length / 4);
  });

  it('serves the partial before the chunk lands, reads safely past it, and swaps in the full section', async () => {
    const { sections, translation } = await fresh();
    expect(sections.isPartialEnglishSection('monitor')).toBe(true);
    expect(sections.hasFullEnglishSection('monitor')).toBe(false);

    const t = translation.getActiveTranslations() as unknown as { monitor: Record<string, unknown> };
    expect(typeof t.monitor.titlebar).toBe('string');

    const full = (await import('../section-locales/en/monitor.json')).default as Record<string, unknown>;
    const lateKey = Object.keys(full).find((k) => !(k in (t.monitor as object)) || t.monitor[k] === undefined)!;
    expect(lateKey).toBeDefined();
    expect(t.monitor[lateKey]).toBeUndefined();

    await translation.preloadSectionsAsync('en', ['monitor']);
    expect(sections.hasFullEnglishSection('monitor')).toBe(true);
    const after = translation.getActiveTranslations() as unknown as { monitor: Record<string, unknown> };
    expect(after.monitor[lateKey]).toEqual(full[lateKey]);
  });

  it('keeps no partial section in the eager core and has a lazy loader for each', async () => {
    const { gen } = await fresh();
    const { sectionLoaders } = await import('../generated/sectionLoaders');
    for (const section of Object.keys(gen.EN_PARTIAL_SECTION_STRINGS)) {
      expect(Object.keys(gen.EN_CORE_SECTION_STRINGS), section).not.toContain(section);
      expect(Object.keys(sectionLoaders).some((p) => p.endsWith(`/en/${section}.json`)), section).toBe(true);
    }
  });
});
