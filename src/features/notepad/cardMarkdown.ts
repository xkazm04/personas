// The markdown a notepad CARD shows and edits as formatted text.
//
// A card never displays markdown syntax — not at rest and not while typing.
// The note is still STORED as plain markdown (the same text the editor, Athena
// and `/note-task` read), so this module is a two-way bridge over a deliberate
// subset: lines, `#`–`###` headings, `>` quotes, bullet / numbered / checklist
// items, and `**bold**`, `_italic_`, `` `code` `` inline. That subset is what a
// hundred-character card note uses; anything richer (tables, links, fenced
// code) is the full editor's job, and a note carrying it renders there.
//
// Element classes come from the shared `card` markdown density, so a card
// being edited looks exactly like the card at rest.
import { MARKDOWN_CARD_DENSITY as D } from '@/features/shared/components/editors/markdownVariants';

export const CHECKBOX_CLASS = 'mr-1.5 align-middle accent-primary';
export const CHECKLIST_UL_CLASS = 'list-none pl-0 space-y-1 my-2 typo-body text-foreground';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

const CODE = /`([^`\n]+)`/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const EM = /(^|[^\w*])[_*]([^_*\n]+)[_*](?![\w*])/g;

type Line =
  | { kind: 'line' | 'quote'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'item'; list: 'ul' | 'ol'; checked: boolean | null; text: string };

function parseLine(line: string): Line {
  let m: RegExpExecArray | null;
  if ((m = /^[-*+] \[( |x|X)\] (.*)$/.exec(line))) return { kind: 'item', list: 'ul', checked: m[1] !== ' ', text: m[2] ?? '' };
  if ((m = /^[-*+] (.*)$/.exec(line))) return { kind: 'item', list: 'ul', checked: null, text: m[1] ?? '' };
  if ((m = /^\d+\. (.*)$/.exec(line))) return { kind: 'item', list: 'ol', checked: null, text: m[1] ?? '' };
  if ((m = /^(#{1,3}) (.*)$/.exec(line))) return { kind: 'heading', level: (m[1] ?? '#').length, text: m[2] ?? '' };
  if ((m = /^> ?(.*)$/.exec(line))) return { kind: 'quote', text: m[1] ?? '' };
  return { kind: 'line', text: line };
}

function inlineHtml(text: string): string {
  const html = escapeHtml(text)
    .replace(CODE, `<code class="${D.code}">$1</code>`)
    .replace(BOLD, `<strong class="${D.strong}">$1</strong>`)
    .replace(EM, `$1<em class="${D.em}">$2</em>`);
  return html || '<br>';
}

/** Markdown → the card's HTML. Every character of user text is escaped first. */
export function markdownToCardHtml(md: string): string {
  const out: string[] = [];
  let open: { tag: 'ul' | 'ol'; checklist: boolean } | null = null;
  for (const raw of md.split('\n')) {
    const line = parseLine(raw);
    if (line.kind === 'item') {
      const checklist = line.checked !== null;
      if (!open || open.tag !== line.list || open.checklist !== checklist) {
        if (open) out.push(`</${open.tag}>`);
        open = { tag: line.list, checklist };
        const cls = checklist ? CHECKLIST_UL_CLASS : line.list === 'ul' ? D.ul : D.ol;
        out.push(`<${line.list} class="${cls}"${checklist ? ' data-checklist=""' : ''}>`);
      }
      const box = checklist
        ? `<input type="checkbox" contenteditable="false" class="${CHECKBOX_CLASS}"${line.checked ? ' checked' : ''}>`
        : '';
      out.push(`<li class="${D.li}">${box}${inlineHtml(line.text)}</li>`);
      continue;
    }
    if (open) out.push(`</${open.tag}>`);
    open = null;
    if (line.kind === 'heading') {
      const cls = line.level === 1 ? D.h1 : line.level === 2 ? D.h2 : D.h3;
      out.push(`<h${line.level} class="${cls}">${inlineHtml(line.text)}</h${line.level}>`);
    } else if (line.kind === 'quote') {
      out.push(`<blockquote class="${D.blockquote}">${inlineHtml(line.text)}</blockquote>`);
    } else {
      out.push(`<div>${inlineHtml(line.text)}</div>`);
    }
  }
  if (open) out.push(`</${open.tag}>`);
  return out.join('');
}

/** Replace `root`'s content with the rendered note. Parsed, never assigned as
 *  `innerHTML` — and the only markup in the string is this module's own. */
export function renderCardMarkdown(root: Element, md: string): void {
  const doc = new DOMParser().parseFromString(`<body>${markdownToCardHtml(md)}</body>`, 'text/html');
  root.replaceChildren(...Array.from(doc.body.childNodes));
}

/** What a reader sees: the note with its markdown markers removed. */
export function markdownToPlainText(md: string): string {
  return md
    .split('\n')
    .map((raw) => parseLine(raw).text.replace(CODE, '$1').replace(BOLD, '$1').replace(EM, '$1$2'))
    .join('\n');
}

const TAG_CLASS: Record<string, string> = {
  H1: D.h1, H2: D.h2, H3: D.h3, OL: D.ol, LI: D.li, BLOCKQUOTE: D.blockquote,
  CODE: D.code, STRONG: D.strong, B: D.strong, EM: D.em, I: D.em,
};

/** Re-stamp density classes on elements the browser created while editing
 *  (`formatBlock`, a new list item) so they match the rendered card. */
export function applyCardDensity(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const cls = el.tagName === 'UL' ? (el.hasAttribute('data-checklist') ? CHECKLIST_UL_CLASS : D.ul) : TAG_CLASS[el.tagName];
    if (cls && el.getAttribute('class') !== cls) el.setAttribute('class', cls);
  }
}

// --- DOM → markdown ------------------------------------------------------------

const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);

/** Markers go OUTSIDE surrounding whitespace: `**bold **` is not bold markdown. */
function wrap(inner: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m || !m[2]) return inner;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const inner = Array.from(el.childNodes, inlineMarkdown).join('');
  switch (el.tagName) {
    case 'STRONG': case 'B': return wrap(inner, '**');
    case 'EM': case 'I': return wrap(inner, '_');
    case 'CODE': return wrap(inner, '`');
    case 'BR': return '\n';
    case 'INPUT': return '';
    default: return inner;
  }
}

/** The editable card's DOM → the markdown that is stored. */
export function cardDomToMarkdown(root: Element): string {
  const lines: string[] = [];
  let loose: string | null = null;
  const flushLoose = () => {
    if (loose !== null) lines.push(...loose.split('\n'));
    loose = null;
  };
  const pushBlock = (el: Element, prefix = '') => {
    // A trailing <br> is the browser's placeholder in an empty block, not a line.
    inlineMarkdown(el).replace(/\n$/, '').split('\n').forEach((part, i) => lines.push(i === 0 ? prefix + part : part));
  };

  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
      if (!el || !BLOCK_TAGS.has(el.tagName)) {
        if (el?.tagName === 'BR') {
          lines.push(...(loose ?? '').split('\n'));
          loose = null;
        } else {
          loose = (loose ?? '') + inlineMarkdown(node);
        }
        continue;
      }
      flushLoose();
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        let n = 0;
        for (const li of Array.from(el.children)) {
          if (li.tagName !== 'LI') continue;
          n += 1;
          const box = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
          pushBlock(li, el.tagName === 'OL' ? `${n}. ` : box ? `- [${box.checked ? 'x' : ' '}] ` : '- ');
        }
      } else if (/^H[1-6]$/.test(el.tagName)) {
        pushBlock(el, `${'#'.repeat(Math.min(3, Number(el.tagName[1])))} `);
      } else if (el.tagName === 'BLOCKQUOTE') {
        pushBlock(el, '> ');
      } else if (Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName))) {
        walk(el); // the browser nests a block per line; walk it rather than flatten it
      } else {
        pushBlock(el);
      }
    }
  };

  walk(root);
  flushLoose();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
