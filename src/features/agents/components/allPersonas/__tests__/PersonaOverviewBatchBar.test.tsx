import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaOverviewBatchBar } from '../PersonaOverviewBatchBar';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('PersonaOverviewBatchBar double-submit', () => {
  it('fires a bulk archive once however many times it is clicked', () => {
    // handleBatchArchive walks the selection one IPC call at a time, so a
    // second click while the first is in flight archives every selected
    // persona twice. The move-to-team path already guarded itself; archive
    // and restore did not.
    const d = deferred();
    const onArchive = vi.fn(() => d.promise);
    render(
      <PersonaOverviewBatchBar count={3} onDelete={() => {}} onClear={() => {}} onArchive={onArchive} />,
    );
    const btn = screen.getByRole('button', { name: /archive/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onArchive).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  it('fires a bulk restore once however many times it is clicked', () => {
    const d = deferred();
    const onRestore = vi.fn(() => d.promise);
    render(
      <PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onRestore={onRestore} />,
    );
    const btn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onRestore).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  it('leaves the synchronous delete and clear actions on every click', () => {
    const onDelete = vi.fn();
    const onClear = vi.fn();
    render(<PersonaOverviewBatchBar count={1} onDelete={onDelete} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
