// The engine dot names an ENGINE, so it never borrows a status tone (which the
// same row uses for state) and no two engines share a hue (note c).
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SeatLabel } from '../SeatLabel';

afterEach(cleanup);

const dotClass = (spec: string) => {
  const { container } = render(<SeatLabel spec={spec} />);
  const dot = container.querySelector('span[aria-hidden].rounded-pill');
  const cls = [...(dot?.classList ?? [])].find((c) => c.startsWith('bg-')) ?? '';
  cleanup();
  return cls;
};

describe('engine dots', () => {
  it('Claude, Codex and Grok get distinct, non-status colours', () => {
    const dots = ['claude:claude-opus-5-5@xhigh', 'codex:gpt-6-sol@high', 'grok:grok-4-7@high'].map(dotClass);
    expect(new Set(dots).size).toBe(3);
    for (const d of dots) {
      expect(d).not.toMatch(/^bg-status-/);
      expect(d).not.toBe('bg-primary');
    }
  });
});
