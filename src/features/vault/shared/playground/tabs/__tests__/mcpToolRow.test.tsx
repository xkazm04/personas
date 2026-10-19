import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolRow } from '../McpToolRow';

const TOOL = { name: 'search_issues', description: 'Search issues', input_schema: null } as never;

describe('ToolRow', () => {
  it('renders Run and the expander as siblings, not a button inside a button', () => {
    const { container } = render(
      <ToolRow tool={TOOL} isExpanded={false} isSelected={false} onToggle={vi.fn()} onRun={vi.fn()} />,
    );
    expect(container.querySelector('button button')).toBeNull();
  });

  it('runs without toggling, and the expander reports its state', () => {
    const onToggle = vi.fn();
    const onRun = vi.fn();
    render(<ToolRow tool={TOOL} isExpanded={false} isSelected={false} onToggle={onToggle} onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /search_issues/ }).getAttribute('aria-expanded')).toBe('false');
  });
});
