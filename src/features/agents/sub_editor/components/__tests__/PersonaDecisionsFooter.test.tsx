import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const companionListDesignDecisions = vi.fn();
const setSidebarSection = vi.fn();
const setPluginTab = vi.fn();
const setCompanionPluginTab = vi.fn();

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>(
    '@/api/companion',
  );
  return {
    ...actual,
    companionListDesignDecisions: (...args: unknown[]) =>
      companionListDesignDecisions(...args),
  };
});

vi.mock('@/stores/systemStore', () => {
  const state = { sidebarSection: 'personas' };
  const hook = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(state);
  (hook as unknown as { getState: () => unknown }).getState = () => ({
    setSidebarSection,
    setPluginTab,
    setCompanionPluginTab,
  });
  return { useSystemStore: hook };
});

import { PersonaDecisionsFooter } from '../PersonaDecisionsFooter';

beforeEach(() => {
  companionListDesignDecisions.mockReset();
  setSidebarSection.mockReset();
  setPluginTab.mockReset();
  setCompanionPluginTab.mockReset();
});

describe('PersonaDecisionsFooter', () => {
  it('renders nothing while the fetch is in flight', () => {
    companionListDesignDecisions.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(
      <PersonaDecisionsFooter personaId="persona_abc" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('stays silent when no decisions for this persona', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    const { container } = render(
      <PersonaDecisionsFooter personaId="persona_abc" />,
    );
    await waitFor(() => {
      expect(companionListDesignDecisions).toHaveBeenCalledWith(
        'persona_abc',
        20,
      );
    });
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('shows the singular label when exactly one decision exists', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'Model tier',
        choice: 'Sonnet',
        rationale: 'mid-volume drafting',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
    ]);
    render(<PersonaDecisionsFooter personaId="persona_abc" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('persona-decisions-footer'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/1 design decision/i)).toBeInTheDocument();
  });

  it('expands to show decision rows on click', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'Model tier',
        choice: 'Sonnet',
        rationale: 'right tier',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
      {
        id: 'dec_2',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'Triggers',
        choice: 'Slack only',
        rationale: 'scope',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:31:00Z',
      },
    ]);
    render(<PersonaDecisionsFooter personaId="persona_abc" />);
    await waitFor(() => {
      expect(screen.getByText(/2 design decisions/i)).toBeInTheDocument();
    });
    // collapsed: row content not visible
    expect(screen.queryByText('Model tier')).toBeNull();
    fireEvent.click(screen.getByText(/2 design decisions/i));
    expect(screen.getByText('Model tier')).toBeInTheDocument();
    expect(screen.getByText('Slack only')).toBeInTheDocument();
  });

  it('"Open audit" routes to Companion plugin → Decisions sub-tab', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'X',
        choice: 'Y',
        rationale: 'r',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
    ]);
    render(<PersonaDecisionsFooter personaId="persona_abc" />);
    await waitFor(() => {
      expect(screen.getByText(/Open audit/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Open audit/i));
    expect(setSidebarSection).toHaveBeenCalledWith('plugins');
    expect(setPluginTab).toHaveBeenCalledWith('companion');
    expect(setCompanionPluginTab).toHaveBeenCalledWith('decisions');
  });
});
