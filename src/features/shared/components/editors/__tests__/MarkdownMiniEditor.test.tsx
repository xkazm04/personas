// The editor's whole value is two keystrokes. Both are caret-sensitive string
// surgery, which is exactly the kind of code that breaks without anyone
// noticing until they lose a sentence.
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownMiniEditor } from '../MarkdownMiniEditor';

vi.mock('../MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

/** Host with real state, so the controlled-input round trip is exercised. */
function Host({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return <MarkdownMiniEditor value={v} onChange={setV} testId="ed" ariaLabel="editor" />;
}

const ta = () => screen.getByTestId('ed') as HTMLTextAreaElement;

function caret(at: number, to = at) {
  const el = ta();
  el.selectionStart = at;
  el.selectionEnd = to;
}

describe('MarkdownMiniEditor — Ctrl+B', () => {
  it('wraps the selection', () => {
    render(<Host initial="ship it now" />);
    caret(5, 7); // "it"
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('ship **it** now');
  });

  it('unwraps when the markers sit just outside the selection', () => {
    render(<Host initial="ship **it** now" />);
    caret(7, 9); // "it", inside the existing markers
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('ship it now');
  });

  it('unwraps when the selection includes the markers', () => {
    render(<Host initial="ship **it** now" />);
    caret(5, 11); // "**it**"
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('ship it now');
  });

  it('opens an empty bold pair when nothing is selected', () => {
    render(<Host initial="ship " />);
    caret(5);
    fireEvent.keyDown(ta(), { key: 'b', ctrlKey: true });
    expect(ta().value).toBe('ship ****');
  });

  it('answers to Cmd+B as well', () => {
    render(<Host initial="go" />);
    caret(0, 2);
    fireEvent.keyDown(ta(), { key: 'b', metaKey: true });
    expect(ta().value).toBe('**go**');
  });
});

describe('MarkdownMiniEditor — bullet continuation', () => {
  it('continues a list on Enter', () => {
    render(<Host initial="- first" />);
    caret(7);
    fireEvent.keyDown(ta(), { key: 'Enter' });
    expect(ta().value).toBe('- first\n- ');
  });

  it('preserves the indent and the marker character', () => {
    render(<Host initial="  * first" />);
    caret(9);
    fireEvent.keyDown(ta(), { key: 'Enter' });
    expect(ta().value).toBe('  * first\n  * ');
  });

  it('ENDS the list when Enter lands on an empty bullet', () => {
    // Expression braces, NOT a quoted attribute. A JSX string attribute does
    // not process escape sequences, so a quoted `\n` here would be a literal
    // backslash-n and the fixture would not be the two-line list this test is
    // about — it read as one 12-character line and the assertion failed on a
    // bug in the test rather than in the editor.
    const twoLineList = ['- first', '- '].join('\n');
    render(<Host initial={twoLineList} />);
    caret(10);
    fireEvent.keyDown(ta(), { key: 'Enter' });
    // The empty marker is removed rather than a second one added — otherwise
    // leaving a list would mean deleting characters by hand.
    expect(ta().value).toBe('- first\n');
  });

  it('leaves an ordinary line alone', () => {
    render(<Host initial="plain prose" />);
    caret(11);
    fireEvent.keyDown(ta(), { key: 'Enter' });
    // No preventDefault, no rewrite: the textarea inserts the newline itself,
    // which jsdom does not simulate — the value is unchanged BY THIS HANDLER.
    expect(ta().value).toBe('plain prose');
  });

  it('does not hijack Shift+Enter inside a list', () => {
    render(<Host initial="- first" />);
    caret(7);
    fireEvent.keyDown(ta(), { key: 'Enter', shiftKey: true });
    expect(ta().value).toBe('- first');
  });
});

describe('MarkdownMiniEditor — escape', () => {
  it('calls onCancel and not onCommit', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    render(
      <MarkdownMiniEditor
        value="x" onChange={() => {}} onCancel={onCancel} onCommit={onCommit} testId="ed"
      />,
    );
    fireEvent.keyDown(ta(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
