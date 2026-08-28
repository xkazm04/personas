import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Force exactly one template per load to be dropped as `schema_invalid`, so a
 * load produces a non-empty skip list and `partial` is the honest status. The
 * real catalog has zero skips (111 templates, 0 skipped), which is why this has
 * to be injected: with no skip to lose, the bug below is invisible.
 */
let dropped = false;
vi.mock('../validateTemplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validateTemplate')>();
  return {
    ...actual,
    validateTemplateCatalogEntry: (raw: unknown) => {
      if (!dropped) {
        dropped = true;
        return { valid: false, reason: 'injected by test' };
      }
      return actual.validateTemplateCatalogEntry(raw);
    },
  };
});

const { getTemplateCatalogStatus, invalidateTemplateCatalog } = await import('../templateCatalog');

describe('getTemplateCatalogStatus', () => {
  beforeEach(() => {
    invalidateTemplateCatalog();
    dropped = false;
  });

  it('reports a partial load when a template was dropped for an error reason', async () => {
    const result = await getTemplateCatalogStatus();
    expect(result.status).toBe('partial');
    expect(result.skipped.some((s) => s.reason === 'schema_invalid')).toBe(true);
  });

  /**
   * The regression this test exists for: the status wrapper awaited the
   * templates through the load path and then read the module-level skip list
   * SEPARATELY. `invalidateTemplateCatalog()` resets that list to `[]`, and the
   * load path deliberately declines to write its own back after an
   * invalidation — so a sibling invalidating mid-await left the status computed
   * from one load's templates and an empty skip list, reporting a partial load
   * as fully healthy and hiding the Retry affordance the user needed.
   *
   * The status must be computed from the load it actually awaited.
   */
  it('does not pair its templates with an invalidation empty skip list', async () => {
    const inFlight = getTemplateCatalogStatus();
    invalidateTemplateCatalog();
    const result = await inFlight;

    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.skipped.some((s) => s.reason === 'schema_invalid')).toBe(true);
    expect(result.status).toBe('partial');
  });
});
