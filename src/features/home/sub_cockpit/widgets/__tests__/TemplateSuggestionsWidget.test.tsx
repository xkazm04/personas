import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const companionMatchTemplates = vi.fn();
const setSidebarSection = vi.fn();

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
  });
  return { useSystemStore: hook };
});

import { TemplateSuggestionsWidget } from '../TemplateSuggestionsWidget';

beforeEach(() => {
  companionMatchTemplates.mockReset();
  setSidebarSection.mockReset();
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

  it('uses default limit=3 when not provided', async () => {
    companionMatchTemplates.mockResolvedValueOnce([]);
    render(<TemplateSuggestionsWidget config={{ intent: 'x' }} />);
    await waitFor(() => {
      expect(companionMatchTemplates).toHaveBeenCalledWith('x', 3);
    });
  });
});
