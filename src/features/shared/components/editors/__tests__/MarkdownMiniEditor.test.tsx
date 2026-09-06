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

// ---------------------------------------------------------------------------
// Toolbar + the props that carry it. The FIRST test here is the important one:
// it pins that the component the Ship tab already uses is byte-for-byte the
// same element it was before these props existed.
// ---------------------------------------------------------------------------

/** Host with the toolbar turned on, so the ops run against real selection. */
function ToolbarHost({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return <MarkdownMiniEditor value={v} onChange={setV} testId="ed" ariaLabel="editor" toolbar />;
}

describe('MarkdownMiniEditor — default shape is unchanged', () => {
  it('renders a bare textarea with no toolbar and no preview', () => {
    render(<Host initial="plain" />);
    expect(ta().tagName).toBe('TEXTAREA');
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByTestId('md-toolbar-bold')).toBeNull();
  });
});

describe('MarkdownToolbar', () => {
  it('bolds the selection from the button', () => {
    render(<ToolbarHost initial="ship it now" />);
    caret(5, 7);
    fireEvent.click(screen.getByTestId('md-toolbar-bold'));
    expect(ta().value).toBe('ship **it** now');
  });

  it('italicises with a single underscore', () => {
    render(<ToolbarHost initial="ship it now" />);
    caret(5, 7);
    fireEvent.click(screen.getByTestId('md-toolbar-italic'));
    expect(ta().value).toBe('ship _it_ now');
  });

  it('toggles a heading on and back off', () => {
    render(<ToolbarHost initial="a title" />);
    caret(0);
    fireEvent.click(screen.getByTestId('md-toolbar-h2'));
    expect(ta().value).toBe('## a title');
    fireEvent.click(screen.getByTestId('md-toolbar-h2'));
    expect(ta().value).toBe('a title');
  });

  it('replaces one block marker rather than stacking them', () => {
    render(<ToolbarHost initial="- an item" />);
    caret(0);
    fireEvent.click(screen.getByTestId('md-toolbar-h1'));
    // The bullet is consumed, not prefixed — `# - an item` is not a heading a
    // user asked for.
    expect(ta().value).toBe('# an item');
  });

  it('numbers every line of a multi-line selection', () => {
    render(<ToolbarHost initial={'one\ntwo\nthree'} />);
    caret(0, 13);
    fireEvent.click(screen.getByTestId('md-toolbar-numbered'));
    expect(ta().value).toBe('1. one\n2. two\n3. three');
  });

  it('writes an unchecked checklist marker', () => {
    render(<ToolbarHost initial="do the thing" />);
    caret(0);
    fireEvent.click(screen.getByTestId('md-toolbar-checklist'));
    expect(ta().value).toBe('- [ ] do the thing');
  });

  it('wraps in inline code', () => {
    render(<ToolbarHost initial="call foo now" />);
    caret(5, 8);
    fireEvent.click(screen.getByTestId('md-toolbar-code'));
    expect(ta().value).toBe('call `foo` now');
  });
});

describe('MarkdownMiniEditor — heading shortcuts', () => {
  it('answers to Ctrl+2', () => {
    render(<Host initial="a title" />);
    caret(0);
    fireEvent.keyDown(ta(), { key: '2', ctrlKey: true });
    expect(ta().value).toBe('## a title');
  });

  it('answers to Cmd+I', () => {
    render(<Host initial="go now" />);
    caret(0, 2);
    fireEvent.keyDown(ta(), { key: 'i', metaKey: true });
    expect(ta().value).toBe('_go_ now');
  });
});

describe('MarkdownMiniEditor — readOnly', () => {
  it('renders the value without a textarea', () => {
    render(<MarkdownMiniEditor value="locked text" onChange={() => {}} readOnly testId="ro" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTestId('ro')).toHaveTextContent('locked text');
  });
});
