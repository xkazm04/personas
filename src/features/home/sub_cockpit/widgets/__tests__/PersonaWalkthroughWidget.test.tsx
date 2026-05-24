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

import { PersonaWalkthroughWidget } from '../PersonaWalkthroughWidget';

beforeEach(() => {
  setCompanionPrefill.mockReset();
  setSidebarSection.mockReset();
});

describe('PersonaWalkthroughWidget', () => {
  it('shows empty state when content is missing', () => {
    render(<PersonaWalkthroughWidget config={{ intent: 'x', content: '' }} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders the intent in the header', () => {
    render(
      <PersonaWalkthroughWidget
        config={{
          intent: 'Triage support tickets',
          content: '## Plan\n\nStep one.',
        }}
      />,
    );
    expect(screen.getByText(/Triage support tickets/)).toBeInTheDocument();
  });

  it('renders the "Build from this" footer when intent is present', () => {
    render(
      <PersonaWalkthroughWidget
        config={{
          intent: 'Triage tickets',
          content: 'plan body',
        }}
      />,
    );
    expect(
      screen.getByTestId('companion-walkthrough-commit'),
    ).toBeInTheDocument();
  });

  it('omits the "Build from this" footer when intent is empty', () => {
    render(
      <PersonaWalkthroughWidget
        config={{
          intent: '',
          content: 'plan body',
        }}
      />,
    );
    expect(
      screen.queryByTestId('companion-walkthrough-commit'),
    ).toBeNull();
  });

  it('clicking "Build from this" fires prefill with mode=interactive', () => {
    render(
      <PersonaWalkthroughWidget
        config={{
          intent: 'Triage tickets',
          content: 'plan body',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-walkthrough-commit'));
    expect(setCompanionPrefill).toHaveBeenCalledTimes(1);
    const payload = setCompanionPrefill.mock.calls[0][0];
    expect(payload.intent).toBe('Triage tickets');
    expect(payload.autoLaunch).toBe(false);
    expect(payload.mode).toBe('interactive');
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
  });
});
