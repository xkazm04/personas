/**
 * The hand over the blueprint: while no question is live the table deals no
 * card at all (the blueprint is the waiting surface, no ghost card stands in),
 * while the answer beat holds it the hand is off the table, and through all of
 * it the one status region is the same node, so what it says is announced.
 *
 * The i18n layer is NOT mocked (the real catalog fails on a missing key).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { SetupSessionApi, SetupVoiceApi } from '../../setup/setupContract';
import { CardTable } from '../../experience/table/CardTable';
import { useTurn } from '../../experience/table/useTurn';

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

function session(over: Partial<SetupSessionApi> = {}): SetupSessionApi {
  return {
    stage: 'training', values: {}, focus: 'memories', checklist: [], score: 40,
    question: 'What do you never promise a partner?', answerMode: 'pick', incoming: null, toneChannel: null,
    suggestions: [{ text: 'A date I do not control.', reason: 'honest' }], proposals: [], history: [],
    busy: false, generatorError: null, toneChannels: ['generic'],
    answer: vi.fn().mockResolvedValue(undefined), accept: vi.fn().mockResolvedValue(undefined), dismiss: vi.fn(),
    edit: vi.fn().mockResolvedValue(undefined), skip: vi.fn().mockResolvedValue(undefined), redeal: vi.fn(),
    focusOn: vi.fn(), setStage: vi.fn(), topic: null, topicPreset: null, setTopic: vi.fn(), plan: null,
    planning: false, reconciling: false, lastAnswerOfferIds: [], offerRecord: [],
    editOffer: vi.fn().mockResolvedValue(undefined), steer: vi.fn().mockResolvedValue(undefined), rebuild: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const voice: SetupVoiceApi = {
  supported: false, listening: false, interim: '', error: null, speakEnabled: false, handsFree: false,
  start: vi.fn(), stop: vi.fn(), toggleSpeak: vi.fn(), toggleHandsFree: vi.fn(), speak: vi.fn(),
};

function Table({ api, holding }: { api: SetupSessionApi; holding?: boolean }) {
  const turn = useTurn(api);
  return <CardTable session={api} voice={voice} turn={turn} topicLabel={null} holding={holding} />;
}

describe('the hand over the blueprint', () => {
  it('is dealt while a question is live', () => {
    render(<Table api={session()} />);
    expect(screen.getByTestId('setup-desk-hand')).toBeInTheDocument();
    expect(screen.getByTestId('setup-desk-question')).toHaveTextContent('What do you never promise a partner?');
  });

  it('deals no card, not even a ghost, while no question is live', () => {
    render(<Table api={session({ busy: true, question: null, suggestions: [] })} />);
    expect(screen.queryByTestId('setup-desk-hand')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-desk-turn')).not.toBeInTheDocument();
    expect(screen.getByTestId('setup-desk-status')).not.toBeEmptyDOMElement();
  });

  it('leaves the table while the beat holds it, and the status region stays the same node', async () => {
    const api = session();
    const { rerender } = render(<Table api={api} />);
    const status = screen.getByTestId('setup-desk-status');
    expect(status).toBeEmptyDOMElement();

    rerender(<Table api={api} holding />);
    await waitFor(() => expect(screen.queryByTestId('setup-desk-hand')).not.toBeInTheDocument());
    expect(screen.getByTestId('setup-desk-status')).toBe(status);
    expect(status).not.toBeEmptyDOMElement();

    rerender(<Table api={api} />);
    expect(await screen.findByTestId('setup-desk-hand')).toBeInTheDocument();
    expect(screen.getByTestId('setup-desk-status')).toBe(status);
  });
});
