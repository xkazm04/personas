import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openDialog(...args) }));

import { DirectoryPickerInput } from '../DirectoryPickerInput';
import {
  forgetRecentDirectories,
  readRecentDirectories,
  rememberRecentDirectory,
} from '../directoryRecents';

const SCOPE = 'test-scope';

function Field(props: Partial<React.ComponentProps<typeof DirectoryPickerInput>> = {}) {
  return (
    <DirectoryPickerInput
      value={props.value ?? ''}
      onChange={props.onChange ?? vi.fn()}
      recentsScope={props.recentsScope ?? SCOPE}
      {...props}
    />
  );
}

const browse = () => screen.getByRole('button', { name: /browse/i });

describe('DirectoryPickerInput', () => {
  beforeEach(() => {
    openDialog.mockReset();
    forgetRecentDirectories();
  });

  it('fills the path and remembers it after a successful browse', async () => {
    openDialog.mockResolvedValue('C:/projects/acme');
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    fireEvent.click(browse());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('C:/projects/acme'));
    expect(readRecentDirectories(SCOPE)).toEqual(['C:/projects/acme']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('distinguishes a FAILED dialog from a cancelled one', async () => {
    // Cancel: the dialog resolves null. Silent, no error, nothing remembered.
    openDialog.mockResolvedValue(null);
    const onChange = vi.fn();
    const { unmount } = render(<Field onChange={onChange} />);
    fireEvent.click(browse());
    await waitFor(() => expect(openDialog).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(readRecentDirectories(SCOPE)).toEqual([]);
    unmount();

    // Failure: the dialog throws. Inline error, value untouched, recents untouched.
    openDialog.mockRejectedValue(new Error('plugin unavailable'));
    const onChange2 = vi.fn();
    render(<Field value="C:/kept" onChange={onChange2} />);
    fireEvent.click(browse());
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(onChange2).not.toHaveBeenCalled();
    expect(readRecentDirectories(SCOPE)).toEqual([]);
    const field = screen.getByDisplayValue('C:/kept');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
  });

  it('retries from the inline error and clears it on success', async () => {
    openDialog.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('C:/second/try');
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    fireEvent.click(browse());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('C:/second/try'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('renders recent chips and fills from one without opening the dialog', async () => {
    rememberRecentDirectory(SCOPE, 'C:/projects/older');
    rememberRecentDirectory(SCOPE, 'C:/projects/newer');
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    const group = screen.getByRole('group', { name: /recent folders/i });
    const chips = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
    expect(chips).toEqual(['C:/projects/newer', 'C:/projects/older']); // newest first

    fireEvent.click(screen.getByText('C:/projects/older'));
    expect(onChange).toHaveBeenCalledWith('C:/projects/older');
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('renders no chip row before any successful pick, and hides the current value', () => {
    const { unmount } = render(<Field />);
    expect(screen.queryByRole('group')).toBeNull();
    unmount();

    rememberRecentDirectory(SCOPE, 'C:/only');
    render(<Field value="C:/only" />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('honours showRecents={false}', () => {
    rememberRecentDirectory(SCOPE, 'C:/hidden');
    render(<Field showRecents={false} />);
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('directoryRecents', () => {
  beforeEach(() => forgetRecentDirectories());

  it('keeps most-recent-first, de-duplicates and caps the list', () => {
    for (const p of ['a', 'b', 'c', 'd', 'e']) rememberRecentDirectory(SCOPE, p);
    expect(readRecentDirectories(SCOPE)).toEqual(['e', 'd', 'c', 'b']);
    expect(rememberRecentDirectory(SCOPE, 'c')).toEqual(['c', 'e', 'd', 'b']);
  });

  it('reads an untouched scope as empty', () => {
    expect(readRecentDirectories('never-used')).toEqual([]);
  });

  it('forgets one scope without touching the others', () => {
    rememberRecentDirectory('one', 'C:/one');
    rememberRecentDirectory('two', 'C:/two');
    forgetRecentDirectories('one');
    expect(readRecentDirectories('one')).toEqual([]);
    expect(readRecentDirectories('two')).toEqual(['C:/two']);
  });

  it('keeps scopes apart', () => {
    rememberRecentDirectory('one', 'C:/one');
    rememberRecentDirectory('two', 'C:/two');
    expect(readRecentDirectories('one')).toEqual(['C:/one']);
    expect(readRecentDirectories('two')).toEqual(['C:/two']);
  });
});
