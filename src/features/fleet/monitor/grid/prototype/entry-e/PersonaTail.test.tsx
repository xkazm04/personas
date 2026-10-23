/**
 * The tail's narrow-column contract, as structure (jsdom has no layout): the
 * name and the lead share a one-line WRAP head, where the name asks only for
 * its floor and grows into the rest, so the lead stays beside a name truncated
 * to its floor and leaves whole below it; the next start sits in its own wrap
 * slot after the head and only ever takes the room left over (flex 1, basis
 * 0), so it leaves first; every time token is `whitespace-nowrap` and never
 * shrinks; an absent schedule draws no slot at all.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { nameFlex, TailHead } from './PersonaTail';
import { personaTail, type TailInput } from './personaTailModel';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const base: TailInput = {
  kind: 'resting', peer: false, runningSince: null, queued: 0,
  lastStatus: 'completed', lastRunAt: new Date(NOW - 2 * 3_600_000).toISOString(), nextMs: NOW + 30 * 60_000, now: NOW,
};

function parts(input: TailInput): HTMLElement[] {
  const { container } = render(<div><TailHead name="Leave Planner" tail={personaTail(input)} now={NOW} /></div>);
  return Array.from(container.firstElementChild!.children) as HTMLElement[];
}

function both(input: TailInput): [HTMLElement, HTMLElement] {
  const [head, next] = parts(input);
  if (!head || !next) throw new Error('expected the head and the next-start slot');
  return [head, next];
}

const oneLineWrap = (el: HTMLElement) => {
  expect(el.className).toMatch(/\bflex-wrap\b/);
  expect(el.className).toMatch(/\boverflow-hidden\b/);
  expect(el.className).toMatch(/\bh-[56]\b/);
};

describe('TailHead: priority drop', () => {
  it('puts the name and the lead in one one-line wrap head, the name first', () => {
    const [head] = both(base);
    oneLineWrap(head);
    const [name, lead] = Array.from(head.children) as HTMLElement[];
    expect(name!.textContent).toBe('Leave Planner');
    // Its flex (`nameFlex`, below) is a min() jsdom's style parser drops, so it is pinned there.
    expect(name!.className).toMatch(/\btruncate\b/);
    expect(lead!.dataset.testid).toBe('persona-line-lead');
    expect(lead!.textContent).toContain('2h');
  });

  it('gives the next start its own wrap slot that only takes the leftover room', () => {
    const [, next] = both(base);
    oneLineWrap(next);
    expect(next.className).toMatch(/\bflex-1\b/);
    // The zero-width spacer owns line one, so a start that does not fit wraps away whole.
    expect((next.firstElementChild as HTMLElement).className).toMatch(/\bw-0\b/);
    expect(next.querySelector('[data-testid="persona-line-next"]')).not.toBeNull();
  });

  it('never lets a time token break or shrink', () => {
    const [head, next] = both(base);
    for (const tok of [head.children[1], next.children[1]] as HTMLElement[]) {
      expect(tok.className).toMatch(/\bwhitespace-nowrap\b/);
      expect(tok.className).toMatch(/\bflex-shrink-0\b/);
    }
  });

  it('draws no next slot when no schedule is known', () => {
    const drawn = parts({ ...base, nextMs: null });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.querySelector('[data-testid="persona-line-next"]')).toBeNull();
  });
});

describe('nameFlex', () => {
  it('asks for 6.5rem for a long name and its own length for a short one', () => {
    expect(nameFlex('Invoice Reconciler').flex).toBe('1 1 min(6.5rem, 17ch)');
    expect(nameFlex('Ops').flex).toBe('1 1 min(6.5rem, 3ch)');
    expect(nameFlex('Ops').maxWidth).toBe('max-content');
  });
});
