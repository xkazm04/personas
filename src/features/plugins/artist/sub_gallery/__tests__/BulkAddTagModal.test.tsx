import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BulkAddTagModal from '../BulkAddTagModal';

describe('BulkAddTagModal', () => {
  it('renders title, subtitle (interpolating count), and the input', () => {
    render(<BulkAddTagModal count={4} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/add tag to selection/i)).toBeInTheDocument();
    expect(screen.getByText(/4 selected/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/tag to add/i)).toBeInTheDocument();
  });

  it('disables the apply button while the input is empty', () => {
    render(<BulkAddTagModal count={1} onSubmit={vi.fn()} onClose={vi.fn()} />);
    const apply = screen.getByRole('button', { name: /apply/i }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('enables the apply button after typing', () => {
    render(<BulkAddTagModal count={1} onSubmit={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/tag to add/i);
    fireEvent.change(input, { target: { value: 'forest' } });
    const apply = screen.getByRole('button', { name: /apply/i }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it('submits the trimmed tag and is not invoked with leading/trailing whitespace', () => {
    const onSubmit = vi.fn();
    render(<BulkAddTagModal count={1} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/tag to add/i);
    fireEvent.change(input, { target: { value: '  forest  ' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onSubmit).toHaveBeenCalledWith('forest');
  });

  it('Enter submits when the input is non-empty', () => {
    const onSubmit = vi.fn();
    render(<BulkAddTagModal count={1} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/tag to add/i);
    fireEvent.change(input, { target: { value: 'forest' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('forest');
  });

  it('Enter does not submit while the input is empty', () => {
    const onSubmit = vi.fn();
    render(<BulkAddTagModal count={1} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/tag to add/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<BulkAddTagModal count={1} onSubmit={vi.fn()} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/tag to add/i);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking Cancel calls onClose', () => {
    const onClose = vi.fn();
    render(<BulkAddTagModal count={1} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
