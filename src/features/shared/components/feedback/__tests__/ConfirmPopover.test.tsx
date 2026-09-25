import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmPopover } from '../ConfirmPopover';

function Harness({ onConfirm, tone }: { onConfirm: () => unknown; tone?: 'primary' | 'danger' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)}>
        ask
      </button>
      <ConfirmPopover
        open={open}
        anchorRef={ref}
        tone={tone}
        title="Really?"
        detail="It cannot be undone."
        confirmLabel="Do it"
        cancelLabel="Keep"
        onConfirm={async () => {
          await onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
        testId="pop"
        confirmTestId="pop-go"
      />
    </>
  );
}

describe('ConfirmPopover', () => {
  it('renders title and detail as a labelled dialog, and confirms', async () => {
    const onConfirm = vi.fn(async () => {});
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('ask'));
    const dialog = screen.getByTestId('pop');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAccessibleName('Really?');
    expect(dialog).toHaveTextContent('It cannot be undone.');
    // A reversible action starts focus on the confirm.
    expect(document.activeElement).toBe(screen.getByTestId('pop-go'));
    fireEvent.click(screen.getByTestId('pop-go'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('pop')).toBeNull());
  });

  it('danger tone starts focus on cancel', () => {
    render(<Harness onConfirm={() => {}} tone="danger" />);
    fireEvent.click(screen.getByText('ask'));
    expect(document.activeElement).toHaveTextContent('Keep');
  });

  it('closes on Escape, on an outside press and on cancel', () => {
    render(<Harness onConfirm={() => {}} />);
    fireEvent.click(screen.getByText('ask'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pop')).toBeNull();
    fireEvent.click(screen.getByText('ask'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('pop')).toBeNull();
    fireEvent.click(screen.getByText('ask'));
    fireEvent.click(screen.getByText('Keep'));
    expect(screen.queryByTestId('pop')).toBeNull();
  });

  it('ignores dismissal while the confirm is in flight', async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('ask'));
    fireEvent.click(screen.getByTestId('pop-go'));
    await waitFor(() => expect(screen.getByTestId('pop-go')).toHaveAttribute('aria-busy', 'true'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('pop')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByTestId('pop')).toBeNull());
  });
});
