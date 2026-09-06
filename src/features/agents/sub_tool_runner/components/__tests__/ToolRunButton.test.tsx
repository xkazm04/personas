import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { ToolInvocationCard } from '../ToolInvocationCard';

const tool = { id: 't1', name: 'ping', description: null, script_path: null, category: 'api', input_schema: null } as unknown as PersonaToolDefinition;

describe('ToolInvocationCard Run button while running', () => {
  it('keeps a visible glyph inside the disabled button', () => {
    render(<ToolInvocationCard tool={tool} isRunning result={null} error={null} onRun={() => {}} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-ping'));
    const btn = screen.getByTestId('tool-run-ping');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // feedback/LoadingSpinner renders null, so the old swap left the button
    // with no icon at all while a run was in flight.
    expect(btn.querySelector('svg')).not.toBeNull();
  });
});
