import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnimatedCounter } from '../AnimatedCounter';

const group = (v: number) => Math.round(v).toLocaleString('en-US');

/** Text a screen reader can reach: every text node with no aria-hidden ancestor. */
function accessibleText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('[aria-hidden="true"]')) out += n.textContent ?? '';
  }
  return out;
}

describe('AnimatedCounter', () => {
  it('roll mode exposes the whole value to assistive tech, not just its separators', () => {
    const { container } = render(<AnimatedCounter value={1234} formatFn={group} mode="roll" />);
    // Each digit slot stacks 0-9 and is aria-hidden; before the fix the only
    // readable glyph of "1,234" was the comma.
    expect(accessibleText(container)).toBe('1,234');
  });

  it('fade mode reads the value once', () => {
    const { container } = render(<AnimatedCounter value={1234} formatFn={group} />);
    expect(accessibleText(container)).toBe('1,234');
  });
});
