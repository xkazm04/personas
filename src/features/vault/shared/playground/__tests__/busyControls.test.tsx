import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequestBuilder } from '../RequestBuilder';

const EP = { method: 'GET', path: '/me', summary: null, description: null, parameters: [], request_body: null, tags: [] } as never;

/** feedback/LoadingSpinner renders null: a control that swapped its icon for it
 *  showed nothing while busy. */
describe('pressed-control busy state', () => {
  it('Send shows a real spinner and says it is sending', () => {
    render(<RequestBuilder endpoint={EP} onSend={vi.fn()} isSending />);
    const send = screen.getByRole('button', { name: /sending/i });
    expect(send.getAttribute('aria-busy')).toBe('true');
    expect(send.querySelector('svg')).not.toBeNull();
  });
});

describe('RequestBuilder path parameters', () => {
  const PARAM_EP = { method: 'GET', path: '/repos/{owner}/issues', summary: null, description: null, parameters: [], request_body: null, tags: [] } as never;

  it('never sends a blank path parameter as its own name', () => {
    const onSend = vi.fn();
    render(<RequestBuilder endpoint={PARAM_EP} onSend={onSend} isSending={false} />);
    const send = screen.getByRole('button', { name: /^send$/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/\/repos\/owner\/issues/)).toBeNull();
  });
});
