import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const register = vi.hoisted(() => ({ rows: [] as Array<{ scope: string; sentences: number }> }));
vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListReplyRegister: vi.fn(async () =>
      register.rows.map((r) => ({ ...r, source: 'operator', reason: null, updatedAt: '' })),
    ),
  };
});

import { useCompanionStore } from '../../../companionStore';
import { AssistantProse } from '../AssistantProse';
import { __resetReplyCapForTests } from '../useReplyCap';

describe('AssistantProse', () => {
  beforeEach(() => {
    __resetReplyCapForTests();
    register.rows = [];
    useCompanionStore.setState({ reportViewId: null });
  });

  it('renders a ref link as a focusable button that opens its target', () => {
    render(<AssistantProse content="I wrote [the audit](ref:report/r1) for you." />);
    const link = screen.getByTestId('companion-ref-link');
    expect(link.tagName).toBe('BUTTON');
    expect(link).toHaveTextContent('the audit');
    fireEvent.click(link);
    expect(useCompanionStore.getState().reportViewId).toBe('r1');
  });

  it('renders an unknown-kind link as plain text', () => {
    render(<AssistantProse content="Open [this widget](ref:widget/w1) later." />);
    expect(screen.queryByTestId('companion-ref-link')).toBeNull();
    expect(screen.getByText(/this widget/)).toBeInTheDocument();
  });

  it('does not fold at the base cap, folds above it, and expands on click', async () => {
    const { unmount } = render(<AssistantProse content="One. Two. Three." />);
    expect(screen.queryByTestId('companion-reply-read-rest')).toBeNull();
    unmount();
    render(<AssistantProse content="One. Two. Three. Four is hidden." />);
    expect(screen.queryByText(/Four is hidden/)).toBeNull();
    fireEvent.click(screen.getByTestId('companion-reply-read-rest'));
    expect(screen.getByText(/Four is hidden/)).toBeInTheDocument();
  });

  it('reads the cap from the register default row', async () => {
    register.rows = [{ scope: 'default', sentences: 5 }];
    render(<AssistantProse content="A. B. C. D. E." />);
    // The first paint uses the base cap; the register read then lifts it to 5.
    expect(await screen.findByText(/D\. E\./)).toBeInTheDocument();
    expect(screen.queryByTestId('companion-reply-read-rest')).toBeNull();
  });

  it('never folds when fold is off (streaming / previews)', () => {
    render(<AssistantProse content="A. B. C. D. E." fold={false} />);
    expect(screen.queryByTestId('companion-reply-read-rest')).toBeNull();
  });
});
