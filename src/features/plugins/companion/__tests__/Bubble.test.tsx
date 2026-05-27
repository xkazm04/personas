import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Bubble } from '../Bubble';

describe('Bubble brain-link strip', () => {
  it('does not render a link strip for user bubbles, even with brain ids in text', () => {
    render(
      <Bubble role="user" index={0} onOpenInBrain={() => {}}>
        Look at goal_abc123 please.
      </Bubble>,
    );
    expect(screen.queryByTestId('companion-brain-links')).toBeNull();
  });

  it('renders a link strip below an assistant bubble that mentions brain ids', () => {
    render(
      <Bubble role="assistant" index={0} onOpenInBrain={() => {}}>
        {'I refreshed goal_abc and procedural_xyz for you.'}
      </Bubble>,
    );
    expect(screen.getByTestId('companion-brain-links')).toBeInTheDocument();
    const chips = screen.getAllByTestId('companion-brain-link');
    expect(chips.map((c) => c.getAttribute('data-id'))).toEqual([
      'goal_abc',
      'procedural_xyz',
    ]);
  });

  it('skips the link strip during streaming (text is incomplete)', () => {
    render(
      <Bubble role="assistant" streaming index={0} onOpenInBrain={() => {}}>
        {'Half-written reply mentions goal_partial'}
      </Bubble>,
    );
    expect(screen.queryByTestId('companion-brain-links')).toBeNull();
  });

  it('omits the strip when onOpenInBrain is not provided', () => {
    render(
      <Bubble role="assistant" index={0}>
        {'Mentions goal_a1b2c3 but no handler wired.'}
      </Bubble>,
    );
    expect(screen.queryByTestId('companion-brain-links')).toBeNull();
  });

  it('clicking a chip forwards the kind+id to onOpenInBrain', () => {
    const onOpen = vi.fn();
    render(
      <Bubble role="assistant" index={0} onOpenInBrain={onOpen}>
        {'You can review design_decision_aa11 anytime.'}
      </Bubble>,
    );
    fireEvent.click(screen.getByTestId('companion-brain-link'));
    expect(onOpen).toHaveBeenCalledWith('design_decision', 'design_decision_aa11');
  });

  it('still renders autonomous-marker bubbles without a link strip', () => {
    render(
      <Bubble role="system" index={0} onOpenInBrain={() => {}}>
        [autonomous continuation #3] mentions goal_xxx
      </Bubble>,
    );
    expect(
      screen.getByTestId('companion-autonomous-marker'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('companion-brain-links')).toBeNull();
  });
});

describe('Bubble machine-grammar strip (OP-line leak guard)', () => {
  it('strips a raw OP: directive line from an assistant bubble', () => {
    render(
      <Bubble role="assistant" index={0}>
        {'Pulling the list now.\n\nOP: {"op":"propose_action","action":"use_connector","params":{"connector_name":"notion","capability":"list_pages"}}'}
      </Bubble>,
    );
    expect(screen.getByText(/Pulling the list now\./)).toBeInTheDocument();
    expect(screen.queryByText(/propose_action/)).toBeNull();
    expect(screen.queryByText(/use_connector/)).toBeNull();
  });

  it('strips a bare {"op": ...} line that slipped past the server strip', () => {
    render(
      <Bubble role="assistant" index={0}>
        {'Done.\n{"op":"propose_action","action":"open_route","params":{"route":"overview"}}'}
      </Bubble>,
    );
    expect(screen.getByText(/Done\./)).toBeInTheDocument();
    expect(screen.queryByText(/open_route/)).toBeNull();
  });

  it('does NOT strip OP-shaped text from user bubbles (their text is theirs)', () => {
    render(
      <Bubble role="user" index={0}>
        {'OP: explain what this means'}
      </Bubble>,
    );
    expect(screen.getByText(/OP: explain what this means/)).toBeInTheDocument();
  });

  it('does not render a brain-link strip for an OP id that only appears inside a stripped directive', () => {
    render(
      <Bubble role="assistant" index={0} onOpenInBrain={() => {}}>
        {'All set.\nOP: {"op":"propose_action","action":"update_goal_status","params":{"id":"goal_should_not_link"}}'}
      </Bubble>,
    );
    // The goal id lived only inside the stripped OP line, so no chip.
    expect(screen.queryByTestId('companion-brain-links')).toBeNull();
  });
});
