// A tab panel's chunk resolving must never leave the body blank: the Suspense
// fallback is the delay-hidden body ghost (was `fallback={null}`, which the
// probe measured as 298-331 ms of nothing under the header on a cold tab).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSystemStore } from '@/stores/systemStore';

// A chunk that never lands: the page is stuck on its fallback.
vi.mock('../sub_setup/SetupPanel', () => new Promise(() => {}));

import AthenaPage from '../AthenaPage';

afterEach(cleanup);

describe('AthenaPage panel fallback', () => {
  it('shows the delayed body ghost while the panel chunk is in flight', () => {
    useSystemStore.setState({ companionsPage: 'athena:setup' });
    const { container } = render(<AthenaPage />);
    const ghost = container.querySelector('[aria-hidden="true"][style*="animation-delay: 150ms"]');
    expect(ghost).not.toBeNull();
    // Chrome stays: the header is not behind the loading state.
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
});
