import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setCompanionPrefill = vi.fn();
const setSidebarSection = vi.fn();

vi.mock('@/stores/systemStore', () => {
  const state = { sidebarSection: 'plugins' };
  const hook = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(state);
  (hook as unknown as { getState: () => unknown }).getState = () => ({
    setCompanionPrefill,
    setSidebarSection,
  });
  return { useSystemStore: hook };
});

import { PersonaReadyWidget } from '../PersonaReadyWidget';

beforeEach(() => {
  setCompanionPrefill.mockReset();
  setSidebarSection.mockReset();
});

function summary(over: Partial<Record<string, unknown>> = {}) {
  return {
    intent_line: 'Triage support tickets by category and priority.',
    ...over,
  };
}

describe('PersonaReadyWidget', () => {
  it('renders empty state when summary missing intent_line', () => {
    render(<PersonaReadyWidget config={{ summary: {} }} />);
    expect(screen.getByText(/refined intent line/i)).toBeInTheDocument();
  });

  it('renders the refined intent prominently', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary(),
          recommended_action: 'interactive',
        }}
      />,
    );
    expect(
      screen.getByText('Triage support tickets by category and priority.'),
    ).toBeInTheDocument();
  });

  it('interactive recommended_action fires prefill with autoLaunch=false + mode=interactive', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary(),
          recommended_action: 'interactive',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-persona-ready-commit'));
    expect(setCompanionPrefill).toHaveBeenCalledTimes(1);
    const payload = setCompanionPrefill.mock.calls[0][0];
    expect(payload.intent).toBe(
      'Triage support tickets by category and priority.',
    );
    expect(payload.autoLaunch).toBe(false);
    expect(payload.mode).toBe('interactive');
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
  });

  it('build_oneshot recommended_action fires prefill with autoLaunch=true + mode=one_shot', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary(),
          recommended_action: 'build_oneshot',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-persona-ready-commit'));
    const payload = setCompanionPrefill.mock.calls[0][0];
    expect(payload.autoLaunch).toBe(true);
    expect(payload.mode).toBe('one_shot');
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
  });

  it('use_template recommended_action skips prefill and routes to design-reviews', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary(),
          recommended_action: 'use_template',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-persona-ready-commit'));
    expect(setCompanionPrefill).not.toHaveBeenCalled();
    expect(setSidebarSection).toHaveBeenCalledWith('design-reviews');
  });

  it('renders summary rows when populated', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary({
            use_cases: ['Golden', 'Variant', 'Out-of-scope'],
            triggers: ['Slack webhook'],
            model_tier: 'sonnet',
            observability: 'manual_reviews queue + weekly success rollup',
          }),
          recommended_action: 'interactive',
        }}
      />,
    );
    expect(screen.getByText(/Golden · Variant · Out-of-scope/)).toBeInTheDocument();
    expect(screen.getByText('Slack webhook')).toBeInTheDocument();
    expect(screen.getByText('sonnet')).toBeInTheDocument();
    expect(
      screen.getByText(/manual_reviews queue \+ weekly success rollup/),
    ).toBeInTheDocument();
  });

  it('exposes the recommended action via data attribute', () => {
    render(
      <PersonaReadyWidget
        config={{
          summary: summary(),
          recommended_action: 'use_template',
        }}
      />,
    );
    const widget = screen.getByTestId('companion-persona-ready-widget');
    expect(widget.getAttribute('data-recommended-action')).toBe('use_template');
  });
});
