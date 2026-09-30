/**
 * Operator-facing browser refusals. Rust puts the next step in `AppError.error`
 * (the hint). The registry has no rule for those hints, so an unclassified
 * resolution must keep the hint. A string the registry does know still takes
 * the friendly rewrite.
 */
import { describe, expect, it } from 'vitest';

import { messageOf } from '../twinDraftLane';

const ORIGIN_HINT =
  'this origin is not on the Whitelist; call browser_request_site to ask the operator, or they can add it under Browser > Whitelist';

describe('messageOf', () => {
  it('keeps an unclassified browser refusal hint', () => {
    const shown = messageOf({ error: ORIGIN_HINT, kind: 'forbidden' });
    expect(shown).toBe(ORIGIN_HINT);
    expect(shown).not.toBe('Something went wrong.');
  });

  it('keeps the hint when the rejection is an object the kind check does not recognise', () => {
    expect(messageOf({ error: ORIGIN_HINT })).toBe(ORIGIN_HINT);
  });

  it('still rewrites a string the registry knows', () => {
    expect(messageOf(new Error('permission denied'))).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it('does not surface a stringified object', () => {
    expect(messageOf('[object Object]')).toBe('Something went wrong.');
  });
});
