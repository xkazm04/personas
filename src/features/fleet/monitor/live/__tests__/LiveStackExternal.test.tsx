/**
 * External feeds into the corner stack (today: Notepad thread entries).
 *
 * The discriminations: a notepad entry renders with live mode OFF (live mode is
 * the switch for channel chatter, not for a decision waiting on the operator);
 * flipping live mode off keeps it; its body click runs the feed's own `open` and
 * acknowledges it; acknowledging it runs the feed's `acknowledge`; and one note
 * holds one row.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSystemStore } from '@/stores/systemStore';

vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (sel: (s: { teams: unknown[]; fetchTeams: () => Promise<void> }) => unknown) =>
    sel({ teams: [], fetchTeams: async () => undefined }),
}));
vi.mock('@/features/teams/sub_teamWorkspace/teamStudio/personaIndex', () => ({
  usePersonaIndex: () => new Map(),
}));
vi.mock('../../channels/mergedFeed', () => ({ MergedChannels: () => null }));

import { LiveChannelOverlay } from '../LiveChannelOverlay';
import { LiveCommsStack } from '../LiveCommsStack';
import { __resetLiveExternalForTests, pushExternalLiveMessage, registerLiveSource } from '../liveExternal';
import type { LiveMessage } from '../liveModel';

function notepadMessage(over: Partial<LiveMessage> = {}): LiveMessage {
  return {
    id: 'notepad:c1',
    teamId: '',
    teamName: 'Notepad',
    teamColor: '',
    personaId: null,
    personaName: 'Agent · note-task',
    personaIcon: null,
    personaColor: null,
    kind: 'persona',
    event: 'Run completed',
    tone: '',
    message: 'Implemented the parser and its tests.',
    at: '2026-09-21T10:00:00Z',
    alert: true,
    receivedAt: 0,
    source: 'notepad',
    noteId: 'n1',
    commentId: 'c1',
    review: { refKind: 'run', pending: true },
    context: 'Notepad · Parser',
    ...over,
  };
}

beforeEach(() => {
  __resetLiveExternalForTests();
  localStorage.clear();
  useSystemStore.setState({ monitorLiveMode: false });
});

afterEach(() => cleanup());

describe('LiveChannelOverlay — external feeds', () => {
  it('renders a notepad entry with live mode OFF', () => {
    render(<LiveChannelOverlay />);
    expect(screen.queryByTestId('live-stack-notepad-n1')).toBeNull();
    act(() => pushExternalLiveMessage(notepadMessage()));
    expect(screen.getByTestId('live-stack-notepad-n1')).toBeInTheDocument();
    expect(screen.getByText('Notepad · Parser')).toBeInTheDocument();
  });

  it('keeps notepad entries when live mode flips off', () => {
    useSystemStore.setState({ monitorLiveMode: true });
    render(<LiveChannelOverlay />);
    act(() => pushExternalLiveMessage(notepadMessage()));
    act(() => useSystemStore.setState({ monitorLiveMode: false }));
    expect(screen.getByTestId('live-stack-notepad-n1')).toBeInTheDocument();
  });

  it('one note holds one row — the newer entry replaces the older', async () => {
    render(<LiveChannelOverlay />);
    act(() => pushExternalLiveMessage(notepadMessage({ id: 'notepad:c1', message: 'older' })));
    act(() => pushExternalLiveMessage(notepadMessage({ id: 'notepad:c2', commentId: 'c2', message: 'newer' })));
    // The replaced row plays its exit before it leaves the DOM.
    await waitFor(() => expect(screen.getAllByTestId('live-stack-notepad-n1')).toHaveLength(1), { timeout: 3000 });
    expect(screen.getByText('newer')).toBeInTheDocument();
  });

  it('body click runs the feed’s open and acknowledges; the check runs its acknowledge', () => {
    const open = vi.fn();
    const acknowledge = vi.fn();
    registerLiveSource('notepad', { open, acknowledge });
    render(<LiveChannelOverlay />);
    act(() => pushExternalLiveMessage(notepadMessage()));
    fireEvent.click(screen.getByTestId('live-stack-notepad-open-n1'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1' }));
    // Opening is reading: the row is acknowledged with it.
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});

describe('LiveCommsStack — a feed’s inline verbs', () => {
  it('renders the registered actions under a notepad row, and nothing extra under a channel row', () => {
    registerLiveSource('notepad', {
      renderActions: (m) => <button type="button">{`approve ${m.commentId}`}</button>,
    });
    render(
      <LiveCommsStack
        messages={[
          notepadMessage(),
          notepadMessage({ id: 'item-9', source: undefined, noteId: undefined, commentId: undefined, message: 'channel talk', teamId: 't1' }),
        ]}
        onDismiss={vi.fn()}
        onDismissAll={vi.fn()}
        onOpenConversation={vi.fn()}
        reducedMotion
      />,
    );
    expect(screen.getAllByText(/^approve /)).toHaveLength(1);
    expect(screen.getByText('approve c1')).toBeInTheDocument();
  });

  it('a channel row still opens Conversations', () => {
    const onOpenConversation = vi.fn();
    render(
      <LiveCommsStack
        messages={[notepadMessage({ id: 'item-9', source: undefined, noteId: undefined, message: 'channel talk', teamId: 't1' })]}
        onDismiss={vi.fn()}
        onDismissAll={vi.fn()}
        onOpenConversation={onOpenConversation}
        onOpenExternal={vi.fn()}
        reducedMotion
      />,
    );
    fireEvent.click(screen.getByText('channel talk'));
    expect(onOpenConversation).toHaveBeenCalledWith('t1', null, 'item-9');
  });
});
