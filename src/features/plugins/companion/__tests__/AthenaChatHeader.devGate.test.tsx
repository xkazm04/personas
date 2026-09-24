import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AthenaChatHeader } from '../chat/AthenaChatHeader';
import { useCompanionStore } from '../companionStore';

vi.mock('@/api/companion', () => ({
  companionRunSleepCycle: vi.fn(),
  companionGetSleepPressure: vi.fn(),
  companionGetFleetBoldness: vi.fn(async () => 'balanced'),
  companionSetFleetBoldness: vi.fn(async () => {}),
}));

// The switcher is a separate surface with its own data needs; this test is
// about ONE thing — who may see the force-cycle control.
vi.mock('../ConversationSwitcher', () => ({
  ConversationSwitcher: () => <div data-testid="conversation-switcher" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderHeader(devModeAvailable: boolean) {
  useCompanionStore.setState({ devModeAvailable });
  return render(<AthenaChatHeader />);
}

describe('AthenaChatHeader — the force-sleep-cycle dev gate', () => {
  it('does not render the force-cycle button for a non-dev user', () => {
    renderHeader(false);
    expect(screen.queryByTestId('companion-force-sleep-cycle')).not.toBeInTheDocument();
    // …while the header itself is perfectly present, so the assertion above is
    // about the gate rather than about a header that failed to render.
    expect(screen.getByTestId('companion-autonomy-options')).toBeInTheDocument();
  });

  it('renders it on a dev build, beside the other dev affordances', () => {
    renderHeader(true);
    expect(screen.getByTestId('companion-force-sleep-cycle')).toBeInTheDocument();
    expect(screen.getByTestId('companion-toggle-dev-mode')).toBeInTheDocument();
  });

  it('keeps the save-log key out of the header (it lives in the dev ledger row)', () => {
    renderHeader(true);
    expect(screen.queryByTestId('companion-dev-dump-log')).not.toBeInTheDocument();
  });
});
