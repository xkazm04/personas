import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptTabsPreview } from '../PromptTabsPreview';
import type { AgentIR } from '@/lib/types/designTypes';

const design: AgentIR = {
  structured_prompt: {
    identity: 'You are a release helper.',
    instructions: '',
    toolGuidance: '',
    examples: '',
    errorHandling: '',
    customSections: [],
  },
  suggested_tools: [],
  suggested_triggers: [],
  full_prompt_markdown: '# Full prompt\n\nEverything at once.',
  summary: 'helper',
};

describe('PromptTabsPreview full-prompt toggle', () => {
  it('reports whether the full prompt is shown', () => {
    render(<PromptTabsPreview designResult={design} />);
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByText('Everything at once.')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Everything at once.')).toBeTruthy();
  });
});
