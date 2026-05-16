import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GallerySelectionBar from '../GallerySelectionBar';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('GallerySelectionBar — render', () => {
  it('shows the selected count, Tag button, Delete button, and Clear button', () => {
    render(
      <GallerySelectionBar
        count={3}
        onDelete={vi.fn()}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // {count} placeholder substitutes to '3'.
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
  });
});

describe('GallerySelectionBar — delete confirm state', () => {
  it('first click on Delete switches to the confirm shape (does not fire onDelete)', () => {
    const onDelete = vi.fn();
    render(
      <GallerySelectionBar
        count={2}
        onDelete={onDelete}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/^delete$/i));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/confirm delete 2/i)).toBeInTheDocument();
  });

  it('second click on Confirm fires onDelete', () => {
    const onDelete = vi.fn();
    render(
      <GallerySelectionBar
        count={2}
        onDelete={onDelete}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/^delete$/i));
    fireEvent.click(screen.getByText(/confirm delete 2/i));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('Cancel returns to the unarmed Delete shape without firing onDelete', () => {
    const onDelete = vi.fn();
    render(
      <GallerySelectionBar
        count={2}
        onDelete={onDelete}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/^delete$/i));
    expect(screen.getByText(/confirm delete 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/confirm delete 2/i)).toBeNull();
  });

  it('auto-cancels confirm after 3 seconds without user input', () => {
    const onDelete = vi.fn();
    render(
      <GallerySelectionBar
        count={2}
        onDelete={onDelete}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/^delete$/i));
    expect(screen.getByText(/confirm delete 2/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/confirm delete 2/i)).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('GallerySelectionBar — clear + tag', () => {
  it('clicking Clear fires onClear', () => {
    const onClear = vi.fn();
    render(
      <GallerySelectionBar
        count={2}
        onDelete={vi.fn()}
        onAddTag={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTitle(/clear selection/i));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('clicking Tag opens the bulk-add modal', () => {
    render(
      <GallerySelectionBar
        count={2}
        onDelete={vi.fn()}
        onAddTag={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/^tag$/i));
    expect(screen.getByText(/add tag to selection/i)).toBeInTheDocument();
  });
});
