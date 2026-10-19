import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SpringCount } from '../SpringCount';

afterEach(() => {
  document.documentElement.removeAttribute('data-motion');
});

describe('SpringCount', () => {
  it('snaps to a new value under the in-app Reduce Motion toggle', () => {
    // framer-motion's useReducedMotion reads only the OS media query; the app's
    // own Appearance toggle is <html data-motion="reduce">.
    document.documentElement.setAttribute('data-motion', 'reduce');
    const fmt = (n: number) => String(n);
    const { container, rerender } = render(<SpringCount value={10} format={fmt} />);
    rerender(<SpringCount value={500} format={fmt} />);
    expect(container.textContent).toBe('500');
  });
});
