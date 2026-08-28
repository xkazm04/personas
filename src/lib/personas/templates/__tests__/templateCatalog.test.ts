import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `registerBuiltinTemplates` is called exactly once per completed catalog load,
 * which makes it the cheapest observable proof of "did a load actually run".
 * Everything else in the verification module stays real so the checksum gate
 * still runs and templates are not silently skipped.
 */
const registerSpy = vi.fn();
vi.mock('@/lib/templates/templateVerification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/templates/templateVerification')>();
  return {
    ...actual,
    registerBuiltinTemplates: (ids: string[]) => {
      registerSpy(ids);
      return actual.registerBuiltinTemplates(ids);
    },
  };
});

const { getTemplateCatalog, invalidateTemplateCatalog } = await import('../templateCatalog');

describe('templateCatalog cache invalidation', () => {
  beforeEach(() => {
    invalidateTemplateCatalog();
    registerSpy.mockClear();
  });

  it('loads once and then serves from cache', async () => {
    await getTemplateCatalog();
    await getTemplateCatalog();
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  // The regression: `_cached = await _loading` published the result of a load
  // that was already in flight when the cache was invalidated, so Retry (and
  // the dev HMR hook, which invalidate for exactly this reason) handed back the
  // pre-invalidation data and no fresh load ever happened.
  it('does not let an in-flight load repopulate the cache after invalidation', async () => {
    const inFlight = getTemplateCatalog();
    invalidateTemplateCatalog();
    await inFlight;

    // If the stale resolve had won, this would be served from `_cached` and the
    // spy would still stand at one call.
    await getTemplateCatalog();
    expect(registerSpy).toHaveBeenCalledTimes(2);
  });

  it('still returns the templates to the caller whose load was invalidated', async () => {
    const inFlight = getTemplateCatalog();
    invalidateTemplateCatalog();
    const templates = await inFlight;
    expect(templates.length).toBeGreaterThan(0);
  });
});
