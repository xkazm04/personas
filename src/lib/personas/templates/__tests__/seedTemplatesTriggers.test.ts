// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getSeedReviews } from '../seedTemplates';

describe('getSeedReviews trigger_types', () => {
  it('resolves recipe_ref use cases to their recipe trigger, so compare does not show 0 triggers', async () => {
    const seeds = await getSeedReviews('en');
    const withTriggers = seeds.filter(
      (s) => (JSON.parse(s.trigger_types ?? '[]') as string[]).length > 0,
    );
    // Before the fix only the single non-recipe_ref template carried triggers.
    expect(withTriggers.length).toBeGreaterThan(seeds.length * 0.8);
  });
});
