/**
 * THE SHARE LINK BELONGS TO THE AGENT ON SCREEN.
 *
 * The publish result was cached in component state and the editor is not
 * remounted per agent, so after switching agents the Share button only
 * re-opened the PREVIOUS agent's popover: the new agent was never published
 * and the link offered for copying was another agent's. Pinned: a different
 * personaId publishes afresh and shows its own link; the same agent re-opens
 * the cached popover without publishing again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@/api/agents/personas', () => ({
  publishPersonaToGallery: (...a: unknown[]) => h.publish(...a),
}));
vi.mock('@/lib/analytics', () => ({ getInstallId: () => 'inst-1', markActivation: vi.fn() }));
vi.mock('@/features/shared/components/buttons/CopyButton', () => ({ CopyButton: () => null }));

import { ShareAgentButton } from '../ShareAgentButton';

beforeEach(() => {
  h.publish.mockReset();
  h.publish.mockImplementation(async (id: string) => ({ slug: id, url: `https://personas.ai/p/${id}` }));
});

describe('ShareAgentButton across an agent switch', () => {
  it('publishes the newly selected agent instead of re-opening the previous link', async () => {
    const { rerender } = render(<ShareAgentButton personaId="pA" />);
    fireEvent.click(screen.getByTestId('agent-share-btn'));
    await waitFor(() => expect(screen.getByTestId('agent-share-url')).toHaveValue('https://personas.ai/p/pA'));

    rerender(<ShareAgentButton personaId="pB" />);
    fireEvent.click(screen.getByTestId('agent-share-btn'));

    await waitFor(() => expect(h.publish).toHaveBeenCalledTimes(2));
    expect(h.publish.mock.calls[1]?.[0]).toBe('pB');
    await waitFor(() => expect(screen.getByTestId('agent-share-url')).toHaveValue('https://personas.ai/p/pB'));
  });

  it('re-opens the cached link for the same agent without publishing again', async () => {
    render(<ShareAgentButton personaId="pA" />);
    fireEvent.click(screen.getByTestId('agent-share-btn'));
    await waitFor(() => expect(screen.getByTestId('agent-share-url')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('agent-share-btn')); // close
    fireEvent.click(screen.getByTestId('agent-share-btn')); // re-open
    await waitFor(() => expect(screen.getByTestId('agent-share-url')).toHaveValue('https://personas.ai/p/pA'));
    expect(h.publish).toHaveBeenCalledTimes(1);
  });
});

describe('ShareAgentButton popover a11y', () => {
  async function openPopover() {
    render(<div><button data-testid="outside">out</button><ShareAgentButton personaId="pA" /></div>);
    fireEvent.click(screen.getByTestId('agent-share-btn'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /shared/i })).toBeInTheDocument());
  }

  it('names the dialog and closes on Escape', async () => {
    await openPopover();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on an outside click', async () => {
    await openPopover();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
