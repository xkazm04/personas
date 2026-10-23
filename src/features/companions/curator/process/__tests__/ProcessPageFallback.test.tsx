// A lazy Process view's chunk in flight must never leave the body blank: the Suspense
// fallback is the delay-hidden body ghost (was `fallback={null}`, which let the
// probe see a ghost-only page with no content for the whole chunk load).
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A chunk that never lands: the page is stuck on its fallback.
vi.mock('../views/dial/DialView', () => new Promise(() => {}));
vi.mock('../useProcessData', () => ({
  // Test double: the page only checks truthiness of `reading`; the adapter below consumes it.
  useProcessData: () => ({ reading: {}, loading: false, error: null }),
}));
vi.mock('../engine/devAdapter', () => ({
  devInstances: () => [{ mode: 'interactive', project: 'a' }],
  devFailure: () => null,
}));
vi.mock('../engine/spine', () => ({ buildSpine: () => ({}) }));

import ProcessPage from '../ProcessPage';

afterEach(cleanup);

describe('ProcessPage view fallback', () => {
  it('shows the delayed body ghost while the view chunk is in flight', () => {
    const { container } = render(<ProcessPage />);
    const ghost = container.querySelector('[aria-hidden="true"][style*="animation-delay: 150ms"]');
    expect(ghost).not.toBeNull();
  });
});
