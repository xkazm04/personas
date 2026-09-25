import { describe, it, expect } from 'vitest';
import { isSafeTestId } from '../useGuidanceRunner';

describe('useGuidanceRunner isSafeTestId (charset guard)', () => {
  it('accepts every real anchor testid used by the registry/catalog', () => {
    // A regression here would mean a legitimate anchor stops rendering its
    // ring/orb -- these are drawn straight from walkthroughs.ts / anchorCatalog.ts.
    for (const id of ['persona-build-entry', 'credential-manager', 'sidebar-home', 'step-0']) {
      expect(isSafeTestId(id)).toBe(true);
    }
  });

  it('rejects a testid containing selector-breaking characters', () => {
    // A quote/bracket/backslash here would otherwise be interpolated
    // directly into `[data-testid="${id}"]` and throw a SyntaxError inside
    // the runner's fire-and-forget async step effect, whose rejection
    // nobody awaits or catches.
    expect(isSafeTestId('bad"id')).toBe(false);
    expect(isSafeTestId('bad]id')).toBe(false);
    expect(isSafeTestId('')).toBe(false);
  });
});
