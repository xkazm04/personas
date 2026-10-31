/**
 * "Does this build question need the full builder?" is ONE rule.
 *
 * It had two bodies: `isDeferredQuestion` (the deck's adapter) and
 * `isComplexQuestion` (the Needs-you rail, via `usePendingInteractions`). Both
 * read the same three fields today; the first new deferral reason added to one
 * of them would have had the rail offering an inline box the deck refuses, or
 * the reverse. The rail's name now IS the adapter's function.
 */
import { describe, it, expect } from 'vitest';

import { isComplexQuestion } from '../../usePendingInteractions';
import { isDeferredQuestion } from '../triageAdapters';

describe('the needs-the-builder rule has one implementation', () => {
  it('isComplexQuestion is isDeferredQuestion, not a second copy of it', () => {
    expect(isComplexQuestion).toBe(isDeferredQuestion);
  });
});
