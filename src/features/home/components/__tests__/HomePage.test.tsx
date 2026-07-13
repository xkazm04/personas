import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Controllable homeTab for the mocked system store.
let currentHomeTab = 'welcome';

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { homeTab: string }) => unknown) =>
    selector({ homeTab: currentHomeTab }),
}));

// Stub every branch child so the test asserts ROUTING, not the child trees.
vi.mock('@/features/home/sub_welcome/HomeWelcome', () => ({
  default: () => <div data-testid="stub-welcome" />,
}));
vi.mock('@/features/home/sub_cockpit/CockpitPanel', () => ({
  default: () => <div data-testid="stub-cockpit" />,
}));
vi.mock('@/features/home/sub_releases/HomeReleases', () => ({
  default: () => <div data-testid="stub-releases" />,
}));
vi.mock('@/features/home/sub_learning/HomeLearning', () => ({
  default: () => <div data-testid="stub-learning" />,
}));
vi.mock('@/features/overview/components/health/SystemHealthPanel', () => ({
  SystemHealthPanel: () => <div data-testid="stub-system-check" />,
}));

import HomePage from '../HomePage';

describe('HomePage tab routing', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the Welcome surface by default', async () => {
    currentHomeTab = 'welcome';
    render(<HomePage />);
    expect(await screen.findByTestId('stub-welcome')).toBeInTheDocument();
  });

  it('routes to the cockpit when homeTab is "cockpit"', async () => {
    currentHomeTab = 'cockpit';
    render(<HomePage />);
    expect(await screen.findByTestId('stub-cockpit')).toBeInTheDocument();
  });

  it('routes to releases when homeTab is "roadmap"', async () => {
    currentHomeTab = 'roadmap';
    render(<HomePage />);
    expect(await screen.findByTestId('stub-releases')).toBeInTheDocument();
  });

  it('routes to learning when homeTab is "learning"', async () => {
    currentHomeTab = 'learning';
    render(<HomePage />);
    expect(await screen.findByTestId('stub-learning')).toBeInTheDocument();
  });

  it('falls back to Welcome for an unknown tab', async () => {
    currentHomeTab = 'something-else';
    render(<HomePage />);
    expect(await screen.findByTestId('stub-welcome')).toBeInTheDocument();
  });
});
