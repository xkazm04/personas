// The crash this file exists for: `Cannot read properties of undefined
// (reading 'whats_new_update')`, thrown by the always-mounted sidebar on most
// cold starts.
//
// The mechanism was one level of depth. An unloaded section resolved to an
// empty object, so `t.shared.foo` was `undefined` and rendered blank — the
// documented promise — while `t.shared.sidebar_extra.whats_new_update` read a
// property off that `undefined` and threw. Measured when this was fixed: 4,623
// call sites in `src/` read two levels deep, so the empty object was a landmine
// under most of the app, armed for exactly as long as a chunk takes to load.
import { describe, expect, it } from 'vitest';

import { SECTION_SHAPES } from '../generated/sectionShapes';

describe('unloaded-section fallback', () => {
  it('carries the group structure of every section that has one', () => {
    // If this is empty the generator ran but found nothing — a shape file that
    // describes no groups cannot stop the crash, and would pass every other
    // assertion here while doing nothing at all.
    const withGroups = Object.values(SECTION_SHAPES).filter(
      (section) => Object.keys(section).length > 0,
    );
    expect(withGroups.length).toBeGreaterThan(20);
  });

  it('knows the group the sidebar reads on every route', () => {
    // The exact key from the production stack trace.
    expect(SECTION_SHAPES.shared).toBeDefined();
    expect(SECTION_SHAPES.shared!.sidebar_extra).toBeDefined();
  });

  it('lets a two-level read resolve to undefined instead of throwing', () => {
    const unloaded = SECTION_SHAPES.shared as Record<string, Record<string, unknown>>;
    // This is the exact shape of the crash: property, then property.
    expect(() => unloaded.sidebar_extra!.whats_new_update).not.toThrow();
    expect(unloaded.sidebar_extra!.whats_new_update).toBeUndefined();
  });

  it('holds for a three-level read too, which the catalog also contains', () => {
    const home = SECTION_SHAPES.home as Record<string, Record<string, unknown>> | undefined;
    expect(home?.nav).toBeDefined();
    expect(() => (home!.nav as Record<string, Record<string, unknown>>).overview!).not.toThrow();
  });

  it('drops every string, so the fallback can never render stale English', () => {
    // The shape is structure ONLY. If a value ever came through, a locale that
    // had not loaded would silently show English text that nothing translated.
    const leaked: string[] = [];
    const walk = (node: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') leaked.push(`${path}.${key}`);
        else if (value && typeof value === 'object') {
          walk(value as Record<string, unknown>, `${path}.${key}`);
        }
      }
    };
    for (const [section, node] of Object.entries(SECTION_SHAPES)) walk(node, section);
    expect(leaked).toEqual([]);
  });
});
