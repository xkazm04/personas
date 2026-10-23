import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EndpointRow } from '../EndpointRow';

const EP = { method: 'GET', path: '/me', summary: null, description: 'who am I', parameters: [], request_body: null, tags: [] } as never;

describe('EndpointRow', () => {
  it('expands from a focusable button that reports its state', () => {
    const onToggle = vi.fn();
    render(<EndpointRow endpoint={EP} isExpanded={false} onToggle={onToggle} onTry={vi.fn()} />);
    const expander = screen.getByRole('button', { name: /\/me/ });
    expect(expander.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expander);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Try does not also toggle the row', () => {
    const onToggle = vi.fn();
    const onTry = vi.fn();
    const { container } = render(<EndpointRow endpoint={EP} isExpanded={false} onToggle={onToggle} onTry={onTry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try' }));
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    expect(container.querySelector('[role="row"]')).toBeNull();
  });
});
