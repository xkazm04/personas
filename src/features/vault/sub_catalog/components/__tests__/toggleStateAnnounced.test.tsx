import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupStepCard } from '../design/setup/SetupStepCard';
import { ForagingResultCard } from '../foraging/ForagingResultCard';
import { StepHeader } from '../negotiator/NegotiatorStepCardHelpers';
import type { ForagedCredential } from '@/api/vault/foraging';
import type { NegotiationStep } from '@/hooks/design/credential/useCredentialNegotiator';
import { Globe } from 'lucide-react';

/**
 * Three controls in the catalog flows toggle a state that was drawn only as an
 * icon or a colour: the setup-step checkmark, the foraging result selector and
 * the negotiator step header (which expands its step). None exposed that state,
 * so a screen reader announced the same thing whether the step was done, the
 * credential selected or the step open.
 */

const credential: ForagedCredential = {
  id: 'env:openai:OPENAI_API_KEY',
  label: 'openai (OPENAI_API_KEY)',
  service_type: 'openai',
  source: 'env_var',
  fields: { api_key: 'sk-...abcd' },
  already_imported: false,
  confidence: 'high',
};

const step: NegotiationStep = {
  title: 'Create a token',
  description: 'Open the developer settings',
  action_type: 'navigate',
  url: null,
  requires_human: false,
  field_fills: null,
  visual_hint: null,
  wait_for: null,
};

describe('toggle controls announce their state', () => {
  it('setup step checkmark exposes done / not done', () => {
    const { rerender } = render(
      <SetupStepCard stepMarkdown="1. Do it" stepIndex={0} isCompleted={false} onToggle={vi.fn()} components={{}} />,
    );
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
    rerender(<SetupStepCard stepMarkdown="1. Do it" stepIndex={0} isCompleted onToggle={vi.fn()} components={{}} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('foraging result exposes selected / not selected', () => {
    const props = { credential, isImporting: false, isImported: false, onToggle: vi.fn() };
    const { rerender } = render(<ForagingResultCard {...props} isSelected={false} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
    rerender(<ForagingResultCard {...props} isSelected />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('negotiator step header exposes expanded / collapsed', () => {
    const props = { step, stepIndex: 0, isCompleted: false, onSelect: vi.fn(), colorClasses: '', Icon: Globe };
    const { rerender } = render(<StepHeader {...props} isActive={false} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    rerender(<StepHeader {...props} isActive />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});
