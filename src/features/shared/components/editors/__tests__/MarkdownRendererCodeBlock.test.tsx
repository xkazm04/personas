import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../MarkdownRenderer';

const longBlock = '```ts\n' + Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```';

describe('MarkdownRenderer code block header', () => {
  it('the collapse control is a disclosure that reports its open state', () => {
    render(<MarkdownRenderer content={longBlock} codeBlockActions />);
    const toggle = screen.getByTestId('companion-code-collapse-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('the wrap control stays an on/off toggle', () => {
    render(<MarkdownRenderer content={longBlock} codeBlockActions />);
    const wrap = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-pressed'));
    expect(wrap).toBeTruthy();
    expect(wrap!.hasAttribute('aria-expanded')).toBe(false);
  });
});
