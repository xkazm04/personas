import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadinessGapPopover } from '../ReadinessGapPopover';
import type { TwinReadiness } from '../../useTwinReadiness';

// Cycle 1 popover. Asserts the three behaviours the user actually
// sees: gap ordering (empty before partial, foundations first), the
// "all set" branch when score === 100, and the deep-link callback
// firing the matching TwinTab id when a gap row is clicked.

function readiness(over: Partial<TwinReadiness> = {}): TwinReadiness {
  return {
    identity: 'complete',
    tone: 'complete',
    brain: 'complete',
    voice: 'complete',
    channels: 'complete',
    memories: 'complete',
    score: 100,
    counts: {
      toneRows: 0,
      toneHasSpecific: false,
      channelsTotal: 0,
      channelsActive: 0,
      memoriesApproved: 0,
      memoriesPending: 0,
    },
    ...over,
  };
}

describe('ReadinessGapPopover', () => {
  beforeEach(() => {
    // Each test re-renders so click-outside listeners from prior tests
    // shouldn't survive — but renderHook teardown handles unmount.
  });

  it('renders the readiness percent on the trigger button', () => {
    render(<ReadinessGapPopover readiness={readiness({ score: 42 })} onJumpTo={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent(/42% ready|42 % ready/);
  });

  it('shows the "all set" body when score === 100 and all milestones complete', () => {
    render(<ReadinessGapPopover readiness={readiness()} onJumpTo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/all set/i)).toBeInTheDocument();
    expect(screen.queryByText(/no bio yet/i)).not.toBeInTheDocument();
  });

  it('orders gaps with empty before partial, identity before tone before brain', () => {
    // Mixed shape: identity empty (severity 1, priority 1),
    // tone partial (severity 0, priority 2), brain empty (severity 1, priority 3).
    // Expected top 3 order: identity-empty, brain-empty, tone-partial.
    const r = readiness({
      identity: 'empty',
      tone: 'partial',
      brain: 'empty',
      score: 50,
      counts: {
        toneRows: 1,
        toneHasSpecific: false,
        channelsTotal: 1,
        channelsActive: 1,
        memoriesApproved: 5,
        memoriesPending: 0,
      },
    });
    render(<ReadinessGapPopover readiness={r} onJumpTo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));

    const buttons = screen.getAllByRole('button');
    // Gap rows are buttons; trigger + close button are also buttons.
    // Find the three gap-row buttons by their distinctive text.
    const identityIdx = buttons.findIndex((b) => /no bio yet/i.test(b.textContent ?? ''));
    const brainIdx = buttons.findIndex((b) => /no knowledge bound/i.test(b.textContent ?? ''));
    const toneIdx = buttons.findIndex((b) => /generic tone only/i.test(b.textContent ?? ''));
    expect(identityIdx).toBeGreaterThan(-1);
    expect(brainIdx).toBeGreaterThan(-1);
    expect(toneIdx).toBeGreaterThan(-1);
    // identity (severity 1, priority 1) before brain (severity 1, priority 3) before tone (severity 0).
    expect(identityIdx).toBeLessThan(brainIdx);
    expect(brainIdx).toBeLessThan(toneIdx);
  });

  it('calls onJumpTo with the matching TwinTab when a gap row is clicked', () => {
    const onJumpTo = vi.fn();
    const r = readiness({
      identity: 'empty',
      score: 0,
      counts: { toneRows: 0, toneHasSpecific: false, channelsTotal: 0, channelsActive: 0, memoriesApproved: 0, memoriesPending: 0 },
    });
    render(<ReadinessGapPopover readiness={r} onJumpTo={onJumpTo} />);
    fireEvent.click(screen.getByRole('button'));

    // The "No bio yet" gap routes to the 'identity' tab.
    const identityRow = screen.getByRole('button', { name: /no bio yet/i });
    fireEvent.click(identityRow);
    expect(onJumpTo).toHaveBeenCalledWith('identity');
  });

  it('caps the visible gap list at 3 and surfaces a "+N more" footer', () => {
    // Five empty milestones → 4 hidden under the top-3 cap → "+2 more".
    const r = readiness({
      identity: 'empty',
      tone: 'empty',
      brain: 'empty',
      voice: 'empty',
      channels: 'empty',
      score: 17,
      counts: { toneRows: 0, toneHasSpecific: false, channelsTotal: 0, channelsActive: 0, memoriesApproved: 5, memoriesPending: 0 },
    });
    render(<ReadinessGapPopover readiness={r} onJumpTo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    // Top three are identity, tone, brain by foundation-priority.
    expect(screen.getByText(/no bio yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no tone captured/i)).toBeInTheDocument();
    expect(screen.getByText(/no knowledge bound/i)).toBeInTheDocument();
    // Voice + channels are over the cap → "+2 more" footer line.
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it('memories-partial hint reports the remaining count to reach strong', () => {
    const r = readiness({
      memories: 'partial',
      score: 92,
      counts: {
        toneRows: 1, toneHasSpecific: true,
        channelsTotal: 1, channelsActive: 1,
        memoriesApproved: 2, memoriesPending: 0,
      },
    });
    render(<ReadinessGapPopover readiness={r} onJumpTo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    // "3 more approved memories to reach strong (2 of 5)."
    expect(screen.getByText(/3 more approved memories to reach strong/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 5/i)).toBeInTheDocument();
  });
});
