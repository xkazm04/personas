/**
 * The pop-up's open gesture used to hand over a TEAM and nothing else, so the
 * preset it produced could only land the reader in the room. The card knows
 * exactly which line it is showing and which persona said it, at the one moment
 * that is free to pass on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LiveMessage } from '../liveModel';
import { LiveCommsStack } from '../LiveCommsStack';

function message(over: Partial<LiveMessage> = {}): LiveMessage {
  return {
    id: 'item-77',
    teamId: 'team-alpha',
    teamName: 'Alpha',
    teamColor: '#6366f1',
    personaId: 'persona-9',
    personaName: 'Dev Clone',
    personaIcon: null,
    personaColor: null,
    kind: 'persona',
    event: 'needs your review',
    eventTone: 'text-foreground',
    message: 'the auth migration is held',
    at: '2026-09-17T10:00:00Z',
    alert: false,
    ...over,
  } as unknown as LiveMessage;
}

describe('LiveCommsStack open gesture', () => {
  it('hands the host the team, the speaker AND the line', () => {
    const onOpenConversation = vi.fn();
    render(
      <LiveCommsStack
        messages={[message()]}
        onDismiss={vi.fn()}
        onDismissAll={vi.fn()}
        onOpenConversation={onOpenConversation}
        reducedMotion
      />,
    );
    fireEvent.click(screen.getByText('the auth migration is held'));
    expect(onOpenConversation).toHaveBeenCalledWith('team-alpha', 'persona-9', 'item-77');
  });

  it('still opens the room for a card with no persona behind it', () => {
    const onOpenConversation = vi.fn();
    render(
      <LiveCommsStack
        messages={[message({ personaId: null, kind: 'event', message: 'step advanced' })]}
        onDismiss={vi.fn()}
        onDismissAll={vi.fn()}
        onOpenConversation={onOpenConversation}
        reducedMotion
      />,
    );
    fireEvent.click(screen.getByText('step advanced'));
    // A null speaker is a null scope, never a missing argument that would drop
    // the item id off the end of the call.
    expect(onOpenConversation).toHaveBeenCalledWith('team-alpha', null, 'item-77');
  });
});
