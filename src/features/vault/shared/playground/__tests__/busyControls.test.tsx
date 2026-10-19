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
