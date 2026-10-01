/**
 * A sample proposal card's three verdicts reach `resolve` with exactly the
 * arguments the contract names: Keep -> accept, Edit -> accept with the edited
 * value, Dismiss -> dismiss. Style dims render as the shared dimension chips
 * and are kept or dismissed whole (no Edit). The source line names where the
 * sample came from, and a failed verdict is answered inline on the card.
 *
 * The i18n layer is NOT mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TwinSample } from '@/lib/bindings/TwinSample';
import type { TwinSampleProposal } from '@/lib/bindings/TwinSampleProposal';
import { SampleProposalCard } from '../desk/SampleProposalCard';
import type { HubSampleProposal } from '../hubContract';

function proposal(over: Partial<TwinSampleProposal> = {}): TwinSampleProposal {
  return {
    id: 'p1', sampleId: 's1', twinId: 't1', kind: 'exemplar', channel: 'email',
    value: 'Thanks, that works for me. Talk Friday.', reason: 'Short, warm sign-off you use often',
    status: 'open', createdAt: '2026-10-01T10:00:00Z', resolvedAt: null, ...over,
  };
}

function sample(over: Partial<TwinSample> = {}): TwinSample {
  return {
    id: 's1', twinId: 't1', text: 'x', channel: 'email', sourceKind: 'selection', sourceHost: 'mail.example.com',
    status: 'ready', error: null, createdAt: '2026-10-01T09:59:00Z', analyzedAt: '2026-10-01T10:00:00Z', ...over,
  };
}

function renderCard(item: HubSampleProposal, error: string | null = null) {
  const onResolve = vi.fn(async () => undefined);
  const view = render(<SampleProposalCard item={item} busy={false} error={error} onResolve={onResolve} />);
  return Object.assign(onResolve, { unmount: view.unmount });
}

describe('SampleProposalCard', () => {
  it('shows the kind, channel, source, value and reason', () => {
    renderCard({ proposal: proposal(), sample: sample() });
    const card = screen.getByTestId('sample-proposal-p1');
    expect(card).toHaveTextContent('Writing sample');
    expect(card).toHaveTextContent('For Email');
    expect(card).toHaveTextContent('From a sample on mail.example.com');
    expect(card).toHaveTextContent('Thanks, that works for me. Talk Friday.');
    expect(card).toHaveTextContent('Short, warm sign-off you use often');
  });

  it('names a clipboard or forge sample, and says nothing when the sample is unknown', () => {
    const first = renderCard({ proposal: proposal(), sample: sample({ sourceKind: 'clipboard', sourceHost: null }) });
    expect(screen.getByTestId('sample-proposal-p1')).toHaveTextContent('From a copied sample');
    first.unmount();
    const second = renderCard({ proposal: proposal({ id: 'p2' }), sample: sample({ sourceKind: 'forge' }) });
    expect(screen.getByTestId('sample-proposal-p2')).toHaveTextContent('From the sample the twin was created with');
    second.unmount();
    renderCard({ proposal: proposal({ id: 'p3' }), sample: null });
    expect(screen.getByTestId('sample-proposal-p3')).not.toHaveTextContent('From a');
  });

  it('Keep accepts', async () => {
    const onResolve = renderCard({ proposal: proposal(), sample: sample() });
    fireEvent.click(screen.getByTestId('sample-proposal-keep'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('accept'));
  });

  it('Dismiss dismisses', async () => {
    const onResolve = renderCard({ proposal: proposal(), sample: sample() });
    fireEvent.click(screen.getByTestId('sample-proposal-dismiss'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('dismiss'));
  });

  it('Edit accepts the edited, trimmed value; cancel restores the card', async () => {
    const onResolve = renderCard({ proposal: proposal({ kind: 'voice', value: 'Lead with the answer' }), sample: sample() });
    fireEvent.click(screen.getByTestId('sample-proposal-edit'));
    const field = screen.getByTestId('sample-proposal-edit-field');
    expect(field).toHaveValue('Lead with the answer');

    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByTestId('sample-proposal-save')).toBeDisabled();

    fireEvent.change(field, { target: { value: '  Lead with the answer, then one reason.  ' } });
    fireEvent.click(screen.getByTestId('sample-proposal-save'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('accept', 'Lead with the answer, then one reason.'));
  });

  it('cancelling an edit writes nothing', () => {
    const onResolve = renderCard({ proposal: proposal({ kind: 'constraint', value: 'No exclamation marks' }), sample: sample() });
    fireEvent.click(screen.getByTestId('sample-proposal-edit'));
    fireEvent.click(screen.getByTestId('sample-proposal-edit-cancel'));
    expect(screen.queryByTestId('sample-proposal-edit-field')).not.toBeInTheDocument();
    expect(screen.getByTestId('sample-proposal-p1')).toHaveTextContent('No exclamation marks');
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('style dims render as dimension chips and offer no Edit', async () => {
    const dims = { formality: 2, warmth: 4, humor: 3, energy: 3, length: 2, directness: 5, expressiveness: 3, detail: 2 };
    const onResolve = renderCard({ proposal: proposal({ kind: 'dims', value: JSON.stringify(dims) }), sample: sample() });
    const card = screen.getByTestId('sample-proposal-p1');
    expect(card).toHaveTextContent('Style');
    expect(card.querySelector('ul')).not.toBeNull();
    expect(card).not.toHaveTextContent('"formality"');
    expect(screen.queryByTestId('sample-proposal-edit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sample-proposal-keep'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('accept'));
  });

  it('malformed dims fall back to the raw value instead of crashing', () => {
    renderCard({ proposal: proposal({ kind: 'dims', value: '{"formality": 9}' }), sample: sample() });
    expect(screen.getByTestId('sample-proposal-p1')).toHaveTextContent('{"formality": 9}');
  });

  it('a failed verdict is answered on the card', () => {
    renderCard({ proposal: proposal(), sample: sample() }, 'not built yet');
    expect(screen.getByRole('alert')).toHaveTextContent('not built yet');
  });
});
