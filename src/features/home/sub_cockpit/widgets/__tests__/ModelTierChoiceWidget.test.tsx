import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelTierChoiceWidget } from '../ModelTierChoiceWidget';

describe('ModelTierChoiceWidget', () => {
  it('renders empty state when no tiers', () => {
    render(<ModelTierChoiceWidget config={{ tiers: [] }} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders all three tiers with rationale', () => {
    render(
      <ModelTierChoiceWidget
        config={{
          intent: 'support triage',
          recommended: 'sonnet',
          tiers: [
            { tier: 'haiku', rationale: 'Too thin for drafting.' },
            { tier: 'sonnet', rationale: 'Right balance.' },
            { tier: 'opus', rationale: 'Overkill for triage.' },
          ],
        }}
      />,
    );
    expect(screen.getByText('Haiku')).toBeInTheDocument();
    expect(screen.getByText('Sonnet')).toBeInTheDocument();
    expect(screen.getByText('Opus')).toBeInTheDocument();
  });

  it('marks the recommended tier with the badge', () => {
    render(
      <ModelTierChoiceWidget
        config={{
          recommended: 'sonnet',
          tiers: [
            { tier: 'haiku', rationale: 'a' },
            { tier: 'sonnet', rationale: 'b' },
            { tier: 'opus', rationale: 'c' },
          ],
        }}
      />,
    );
    // recommended badge text
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    // and the recommended tier has a data attribute we can check
    const sonnet = document.querySelector('[data-tier="sonnet"]');
    expect(sonnet?.getAttribute('data-recommended')).toBe('true');
    const haiku = document.querySelector('[data-tier="haiku"]');
    expect(haiku?.getAttribute('data-recommended')).toBe('false');
  });

  it('sorts tiers left-to-right by capability ladder regardless of input order', () => {
    render(
      <ModelTierChoiceWidget
        config={{
          recommended: 'sonnet',
          tiers: [
            { tier: 'opus', rationale: 'c' },
            { tier: 'haiku', rationale: 'a' },
            { tier: 'sonnet', rationale: 'b' },
          ],
        }}
      />,
    );
    const tierEls = Array.from(document.querySelectorAll('[data-tier]'));
    expect(tierEls.map((el) => el.getAttribute('data-tier'))).toEqual([
      'haiku',
      'sonnet',
      'opus',
    ]);
  });

  it('drops tier rows without rationale', () => {
    render(
      <ModelTierChoiceWidget
        config={{
          recommended: 'sonnet',
          tiers: [
            { tier: 'haiku', rationale: '' }, // dropped
            { tier: 'sonnet', rationale: 'kept' },
          ],
        }}
      />,
    );
    expect(screen.queryByText('Haiku')).toBeNull();
    expect(screen.getByText('Sonnet')).toBeInTheDocument();
  });
});
