import { describe, expect, it } from 'vitest';

import { cardDomToMarkdown, markdownToPlainText, renderCardMarkdown } from '../cardMarkdown';

function roundTrip(md: string): string {
  const root = document.createElement('div');
  renderCardMarkdown(root, md);
  return cardDomToMarkdown(root);
}

describe('card markdown round trip', () => {
  it.each([
    ['a plain line', 'Ship the sweeper fix'],
    ['inline formatting', '**bold**, _italic_ and `code`'],
    ['bullets', '- one\n- two'],
    ['numbered items', '1. first\n2. second'],
    ['a checklist', '- [ ] todo\n- [x] done'],
    ['a heading over body', '# Plan\nthen this'],
    ['a quote', '> evidence'],
    ['a blank line in the middle', 'line one\n\nline three'],
  ])('keeps %s', (_label, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it('renders markers as formatting, not as text', () => {
    const root = document.createElement('div');
    renderCardMarkdown(root, '# Plan\n- **ship** it');
    expect(root.textContent).toBe('Planship it');
    expect(root.querySelector('h1')).not.toBeNull();
    expect(root.querySelector('ul li strong')?.textContent).toBe('ship');
  });

  it('escapes user text instead of parsing it as markup', () => {
    const root = document.createElement('div');
    renderCardMarkdown(root, '<img src=x onerror=alert(1)> & <b>');
    expect(root.querySelector('img')).toBeNull();
    expect(roundTrip('<img src=x onerror=alert(1)> & <b>')).toBe('<img src=x onerror=alert(1)> & <b>');
  });
});

describe('cardDomToMarkdown on browser-shaped markup', () => {
  it('reads the block-per-line DOM contentEditable produces', () => {
    const root = document.createElement('div');
    root.innerHTML = 'first<div>second</div><div><b>bold</b> <i>it</i></div><div><br></div>';
    expect(cardDomToMarkdown(root)).toBe('first\nsecond\n**bold** _it_');
  });

  it('keeps markers outside whitespace and drops the caret spacer', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><strong>bold </strong>\u200bnext</div>';
    expect(cardDomToMarkdown(root)).toBe('**bold** next');
  });

  it('reads a toggled checkbox', () => {
    const root = document.createElement('div');
    renderCardMarkdown(root, '- [ ] todo');
    root.querySelector('input')!.checked = true;
    expect(cardDomToMarkdown(root)).toBe('- [x] todo');
  });
});

describe('markdownToPlainText', () => {
  it('is what a reader sees', () => {
    expect(markdownToPlainText('## Goal\n- [ ] **ship** `it`')).toBe('Goal\nship it');
  });
});
