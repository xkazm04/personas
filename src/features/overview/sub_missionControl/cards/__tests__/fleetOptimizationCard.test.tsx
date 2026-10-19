import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FleetRecommendation } from '@/features/overview/libs/fleetOptimizer';

const rec: FleetRecommendation = {
  id: 'rec-1',
  type: 'investigate_failures',
  severity: 'warning',
  title: 'Recurring failures',
  description: 'One agent keeps failing.',
  personaIds: ['p-1'],
  personaNames: ['Scout'],
  impact: 'Fewer failed runs',
  suggestedAction: 'Review its recent errors',
  generatedAt: '2026-10-19T00:00:00Z',
};

vi.mock('@/features/overview/libs/fleetOptimizer', () => ({
  generateFleetRecommendation: () => rec,
}));
vi.mock('@/features/companions/athena/useForwardToAthena', () => ({
  useForwardToAthena: () => vi.fn(),
}));

describe('FleetOptimizationCard disclosure', () => {
  it('announces whether its details are expanded', async () => {
    const { default: FleetOptimizationCard } = await import('../FleetOptimizationCard');
    render(<FleetOptimizationCard />);

    const toggle = screen.getByRole('button', { name: /Recurring failures/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Review its recent errors')).toBeTruthy();
  });
});
