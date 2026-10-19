import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/agents/lab', () => ({
  labGetToolCalls: () => Promise.resolve([]),
  labGetResultEvents: () => Promise.resolve([]),
  labGetScoreWeights: () => Promise.resolve({ toolAccuracy: 0.4, outputQuality: 0.4, protocolCompliance: 0.2 }),
}));

import { ScenarioDetailPanel } from '../ScenarioDetailPanel';

const base = {
  modelId: 'haiku',
  status: 'completed',
  toolAccuracyScore: 80,
  outputQualityScore: 70,
  protocolCompliance: 90,
  outputPreview: null,
  costUsd: 0,
  durationMs: 0,
  errorMessage: null,
  rationale: null,
  suggestions: null,
};

const pressedThumbs = () =>
  screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');

describe('ScenarioDetailPanel - the rating widget follows the cell it shows', () => {
  it('regression: a rating that loads after the panel opened is shown', () => {
    const props = { onClose: vi.fn(), onRate: vi.fn() };
    const { rerender } = render(<ScenarioDetailPanel {...props} result={{ ...base, scenarioName: 'A' }} />);
    expect(pressedThumbs()).toHaveLength(0);
    rerender(<ScenarioDetailPanel {...props} result={{ ...base, scenarioName: 'A' }} rating={5} />);
    expect(pressedThumbs()).toHaveLength(1);
  });

  it("regression: moving to another cell does not carry the previous cell's rating", () => {
    const props = { onClose: vi.fn(), onRate: vi.fn() };
    const { rerender } = render(<ScenarioDetailPanel {...props} result={{ ...base, scenarioName: 'A' }} rating={1} />);
    expect(pressedThumbs()).toHaveLength(1);
    rerender(<ScenarioDetailPanel {...props} result={{ ...base, scenarioName: 'B' }} />);
    expect(pressedThumbs()).toHaveLength(0);
  });
});
