import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FullScreenOverlay } from '../FullScreenOverlay';

/** framer-motion's `motion.div` forwards the ref, but keep jsdom honest. */
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

function Summoner({ onCloseSpy }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" data-testid="outsider">
        outside
      </button>
      {open && (
        <FullScreenOverlay
          testId="overlay"
          ariaLabel="Schedules"
          onClose={() => {
            onCloseSpy?.();
            setOpen(false);
          }}
        >
          <button type="button" data-testid="inner-first">
            first
          </button>
          <button type="button" data-testid="inner-last">
            last
          </button>
        </FullScreenOverlay>
      )}
    </div>
  );
}

const overlay = () => screen.getByTestId('overlay');

describe('FullScreenOverlay as a dialog', () => {
  it('is a modal dialog with an accessible name', () => {
    render(<Summoner />);
    act(() => screen.getByTestId('opener').click());
    const node = screen.getByRole('dialog', { name: 'Schedules' });
    expect(node).toBe(overlay());
    expect(node).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus inside on open', () => {
    render(<Summoner />);
    act(() => screen.getByTestId('opener').click());
    expect(overlay().contains(document.activeElement)).toBe(true);
  });

  it('traps Tab inside the overlay, both directions', () => {
    render(<Summoner />);
    act(() => screen.getByTestId('opener').click());

    const last = screen.getByTestId('inner-last');
    act(() => last.focus());
    fireEvent.keyDown(window, { key: 'Tab' });
    // Wrapped to the first focusable in the shell (the close button), never
    // out to the opener or the outsider.
    expect(overlay().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByTestId('outsider'));

    const closeButton = overlay().querySelector('button')!;
    act(() => closeButton.focus());
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and returns focus to the summoner', () => {
    const onCloseSpy = vi.fn();
    render(<Summoner onCloseSpy={onCloseSpy} />);
    const opener = screen.getByTestId('opener');
    act(() => opener.focus());
    act(() => opener.click());
    expect(screen.queryByTestId('overlay')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes once when inner content also listens for Escape', () => {
    const onCloseSpy = vi.fn();
    const innerEscape = vi.fn();
    function WithListeningContent() {
      const [open, setOpen] = useState(true);
      return open ? (
        <FullScreenOverlay
          testId="overlay"
          ariaLabel="Schedules"
          onClose={() => {
            onCloseSpy();
            setOpen(false);
          }}
        >
          <button
            type="button"
            data-testid="inner"
            onKeyDown={(e) => {
              if (e.key === 'Escape') innerEscape();
            }}
          >
            inner
          </button>
        </FullScreenOverlay>
      ) : null;
    }
    render(<WithListeningContent />);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(innerEscape).not.toHaveBeenCalled();
  });

  it('closes from the corner button too', () => {
    const onCloseSpy = vi.fn();
    render(<Summoner onCloseSpy={onCloseSpy} />);
    act(() => screen.getByTestId('opener').click());
    act(() => {
      (overlay().querySelector('button') as HTMLElement).click();
    });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('overlay')).toBeNull();
  });
});
