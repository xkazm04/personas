import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const companionMatchTemplates = vi.fn();
const setSidebarSection = vi.fn();
const setPendingTemplateId = vi.fn();
const setTemplateTab = vi.fn();

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>(
    '@/api/companion',
  );
  return {
    ...actual,
    companionMatchTemplates: (...args: unknown[]) =>
      companionMatchTemplates(...args),
  };
});

vi.mock('@/stores/systemStore', () => {
  const state = { sidebarSection: 'plugins' };
  const hook = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(state);
  (hook as unknown as { getState: () => unknown }).getState = () => ({
    setSidebarSection,
    setPendingTemplateId,
    setTemplateTab,
  });
  return { useSystemStore: hook };
});

import { TemplateSuggestionsWidget } from '../TemplateSuggestionsWidget';

beforeEach(() => {
  companionMatchTemplates.mockReset();
  setSidebarSection.mockReset();
  setPendingTemplateId.mockReset();
  setTemplateTab.mockReset();
});

describe('TemplateSuggestionsWidget', () => {
  it('shows an empty state when no matches', async () => {
    companionMatchTemplates.mockResolvedValueOnce([]);
    render(
      <TemplateSuggestionsWidget
        config={{ intent: 'triage support tickets' }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no templates/i)).toBeInTheDocument();
    });
  });

  it('renders top matches with name, category, snippet', async () => {
    companionMatchTemplates.mockResolvedValueOnce([
      {
        id: 't_1',
        name: 'Inbox Triage Buddy',
        snippet: 'Categorizes inbound tickets…',
        category: 'support',
        connectors: ['slack', 'jira'],
      },
    ]);
    render(
      <TemplateSuggestionsWidget config={{ intent: 'triage tickets' }} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Inbox Triage Buddy')).toBeInTheDocument();
      expect(screen.getByText('support')).toBeInTheDocument();
      expect(screen.getByText('slack')).toBeInTheDocument();
      expect(screen.getByText('jira')).toBeInTheDocument();
    });
  });

  it('routes to design-reviews when "Browse the full template gallery" is clicked', async () => {
    companionMatchTemplates.mockResolvedValueOnce([
      {
        id: 't_1',
        name: 'Anything',
        snippet: 's',
        category: 'support',
        connectors: [],
      },
    ]);
    render(<TemplateSuggestionsWidget config={{ intent: 'whatever' }} />);
    await waitFor(() => {
      expect(screen.getByText('Anything')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Browse the full template gallery/i));
    expect(setSidebarSection).toHaveBeenCalledWith('design-reviews');
  });

  // The header promised a per-result "Open template" affordance and the rows
  // were inert: the only control browsed the whole gallery and dropped the
  // intent Athena had just ranked.
  it('opens that template when a match row is clicked', async () => {
    companionMatchTemplates.mockResolvedValueOnce([
      { id: 't_42', name: 'Inbox Triage Buddy', snippet: 's', category: 'support', connectors: [] },
    ]);
    render(<TemplateSuggestionsWidget config={{ intent: 'triage tickets' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('template-suggestion-t_42')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('template-suggestion-t_42'));

    expect(setPendingTemplateId).toHaveBeenCalledWith('t_42');
    expect(setTemplateTab).toHaveBeenCalledWith('generated');
    expect(setSidebarSection).toHaveBeenCalledWith('design-reviews');
  });

  it('keeps the footer as an unfiltered browse, carrying no template id', async () => {
    companionMatchTemplates.mockResolvedValueOnce([
      { id: 't_7', name: 'Anything', snippet: 's', category: null, connectors: [] },
    ]);
    render(<TemplateSuggestionsWidget config={{ intent: 'whatever' }} />);
    await waitFor(() => {
      expect(screen.getByText('Anything')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Browse the full template gallery/i));

    expect(setSidebarSection).toHaveBeenCalledWith('design-reviews');
    expect(setPendingTemplateId).not.toHaveBeenCalled();
  });

  it('never fetches or claims "no templates" without an intent', async () => {
    render(<TemplateSuggestionsWidget config={{}} />);
    await waitFor(() => {
      expect(screen.getByTestId('companion-template-suggestions-widget')).toBeInTheDocument();
    });
    expect(companionMatchTemplates).not.toHaveBeenCalled();
    expect(screen.queryByText(/no templates/i)).toBeNull();
  });

  it('uses default limit=3 when not provided', async () => {
    companionMatchTemplates.mockResolvedValueOnce([]);
    render(<TemplateSuggestionsWidget config={{ intent: 'x' }} />);
    await waitFor(() => {
      expect(companionMatchTemplates).toHaveBeenCalledWith('x', 3);
    });
  });
});
