// Formatting as you type on a card: the markdown you type is consumed and
// becomes formatting, so a marker is on screen for one keystroke at most.
//
// Every change goes through `document.execCommand`, deprecated as it is,
// because it is the one path that keeps the browser's own undo stack intact:
// Ctrl+Z after `**bold**` turned bold gives you back the asterisks.
import { CHECKBOX_CLASS, escapeHtml } from '../../cardMarkdown';

/** Typed at the very start of a line, followed by a space. */
const BLOCK_RULES: { pattern: RegExp; apply: (m: RegExpExecArray) => void }[] = [
  { pattern: /^[-*]$/, apply: () => document.execCommand('insertUnorderedList') },
  { pattern: /^1\.$/, apply: () => document.execCommand('insertOrderedList') },
  { pattern: /^(#{1,3})$/, apply: (m) => document.execCommand('formatBlock', false, `<h${(m[1] ?? '#').length}>`) },
  { pattern: /^>$/, apply: () => document.execCommand('formatBlock', false, '<blockquote>') },
  {
    pattern: /^\[ ?\]$/,
    apply: () => {
      document.execCommand('insertUnorderedList');
      closestElement(window.getSelection()?.anchorNode)?.closest('ul')?.setAttribute('data-checklist', '');
    },
  },
];

/** Completed by the closing character just typed. Lookbehinds keep `**` from
 *  firing the single-star rule and `snake_case` from firing the underscore one. */
const INLINE_RULES: { pattern: RegExp; tag: 'strong' | 'em' | 'code' }[] = [
  { pattern: /(?<!\*)\*\*([^*\n]+)\*\*$/, tag: 'strong' },
  { pattern: /`([^`\n]+)`$/, tag: 'code' },
  { pattern: /(?<![\w*])\*([^*\n]+)\*$/, tag: 'em' },
  { pattern: /(?<![\w_])_([^_\n]+)_$/, tag: 'em' },
];

function closestElement(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function setSelection(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectBefore(node: Text, offset: number, length: number): void {
  const range = document.createRange();
  range.setStart(node, offset - length);
  range.setEnd(node, offset);
  setSelection(range);
}

/** Run the rule the just-typed character completes, if any. */
export function applyInputRule(event: InputEvent, root: Element): void {
  if (event.inputType !== 'insertText' || !event.data) return;
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const text = node as Text;
  const before = text.data.slice(0, selection.anchorOffset);

  if (event.data === ' ') {
    const parent = text.parentElement;
    const atLineStart =
      text.previousSibling === null &&
      (parent === root || (!!parent && (parent.tagName === 'DIV' || parent.tagName === 'P') && parent.parentElement === root));
    if (!atLineStart) return;
    for (const rule of BLOCK_RULES) {
      const m = rule.pattern.exec(before.slice(0, -1));
      if (!m) continue;
      selectBefore(text, selection.anchorOffset, before.length);
      document.execCommand('delete');
      rule.apply(m);
      return;
    }
    return;
  }

  if (!'*_`'.includes(event.data)) return;
  for (const rule of INLINE_RULES) {
    const m = rule.pattern.exec(before);
    if (!m) continue;
    selectBefore(text, selection.anchorOffset, m[0].length);
    // The zero-width space puts the caret OUTSIDE the new element, so the next
    // keystroke is plain text again. The serializer drops it.
    document.execCommand('insertHTML', false, `<${rule.tag}>${escapeHtml(m[1] ?? '')}</${rule.tag}>\u200b`);
    return;
  }
}

/** Every item of a checklist carries its checkbox — including the one Enter just made. */
export function ensureChecklistBoxes(root: Element): void {
  for (const li of Array.from(root.querySelectorAll('ul[data-checklist] > li'))) {
    if (li.querySelector(':scope > input[type="checkbox"]')) continue;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.contentEditable = 'false';
    box.className = CHECKBOX_CLASS;
    li.prepend(box);
    if (window.getSelection()?.anchorNode === li) {
      const range = document.createRange();
      range.setStartAfter(box);
      range.collapse(true);
      setSelection(range);
    }
  }
}

/** Ctrl/Cmd+1/2/3: a heading of that level, or back to a plain line if it is one. */
export function toggleHeading(level: 1 | 2 | 3): void {
  const current = document.queryCommandValue('formatBlock').toLowerCase();
  document.execCommand('formatBlock', false, current === `h${level}` ? '<div>' : `<h${level}>`);
}

export function placeCaretAtEnd(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  setSelection(range);
}
