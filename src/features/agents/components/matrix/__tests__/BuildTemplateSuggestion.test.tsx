import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { CompanionTemplateMatch } from '@/api/companion';

const companionMatchTemplates = vi.fn();

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

import { BuildTemplateSuggestion } from '../BuildTemplateSuggestion';

const MATCH: CompanionTemplateMatch = {
  id: 'review_idea_harvester',
  name: 'Idea Harvester',
  snippet: 'Collects and triages product ideas from a backlog channel.',
  category: 'productivity',
  connectors: ['slack'],
};

beforeEach(() => {
  companionMatchTemplates.mockReset();
});

describe('BuildTemplateSuggestion', () => {
  it('stays silent and fires no match request while inactive', async () => {
    companionMatchTemplates.mockResolvedValue([MATCH]);
    const { container } = render(
      <BuildTemplateSuggestion
        intent="harvest ideas from slack and triage them"
        active={false}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    // Inactive → the hook is fed an empty query, so no card and no IPC call
    // even after the debounce window elapses.
    await new Promise((r) => setTimeout(r, 350));
    expect(companionMatchTemplates).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="build-template-suggestion"]')).toBeNull();
  });

  it('surfaces the top match once active', async () => {
    companionMatchTemplates.mockResolvedValue([MATCH]);
    render(
      <BuildTemplateSuggestion
        intent="harvest ideas from slack and triage them"
        active
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('build-template-suggestion')).toBeTruthy(),
    );
    // Interpolated title carries the matched template name.
    expect(screen.getByText(/Idea Harvester/)).toBeTruthy();
  });

  it('renders nothing when active but no template matches', async () => {
    companionMatchTemplates.mockResolvedValue([]);
    const { container } = render(
      <BuildTemplateSuggestion
        intent="something nothing matches at all here"
        active
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => expect(companionMatchTemplates).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="build-template-suggestion"]'),
      ).toBeNull(),
    );
  });

  it('routes the top match to onAccept', async () => {
    companionMatchTemplates.mockResolvedValue([MATCH]);
    const onAccept = vi.fn();
    render(
      <BuildTemplateSuggestion
        intent="harvest ideas from slack and triage them"
        active
        onAccept={onAccept}
        onDismiss={vi.fn()}
      />,
    );
    const adopt = await screen.findByTestId('build-template-suggestion-adopt');
    fireEvent.click(adopt);
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(MATCH));
  });

  it('fires onDismiss from the keep-building action', async () => {
    companionMatchTemplates.mockResolvedValue([MATCH]);
    const onDismiss = vi.fn();
    render(
      <BuildTemplateSuggestion
        intent="harvest ideas from slack and triage them"
        active
        onAccept={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    const dismiss = await screen.findByTestId('build-template-suggestion-dismiss');
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
