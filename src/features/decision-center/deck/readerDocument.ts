/**
 * The reader's document structure, prepared ONCE per document — following the
 * long-form-reading-surface standard:
 *
 *  - ONE stateful heading-id assigner per document (dedupe set + fallback
 *    counter). The contents list and the rendered headings both take their
 *    ids from the same `prepareDocument` result: the contents read the list,
 *    the renderer's headings are stamped from it in order (`stampHeadingIds`).
 *  - ONE chrome offset: `READER_CHROME_OFFSET` is the height of the reader's
 *    sticky progress bar, the only fixed chrome inside the scroll container.
 *    Jump-to-heading and the reading band both withdraw from it.
 */

export const READER_CHROME_OFFSET = 44;

export interface DocHeading { id: string; text: string; level: 1 | 2 | 3 }

export interface PreparedDocument { headings: DocHeading[]; words: number }

function createAssigner(prefix: string) {
  const issued = new Set<string>();
  let fallback = 0;
  return (text: string): string => {
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    const base = `${prefix}-${slug || `section-${++fallback}`}`;
    let id = base;
    for (let n = 2; issued.has(id); n++) id = `${base}-${n}`;
    issued.add(id);
    return id;
  };
}

/** Markdown headings (outside fenced blocks) + word count. The caller memoises it per document. */
export function prepareDocument(markdown: string, prefix = 'dcr'): PreparedDocument {
  const assign = createAssigner(prefix);
  const headings: DocHeading[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = m[2]!.replace(/[*_`]/g, '');
      headings.push({ id: assign(text), text, level: m[1]!.length as 1 | 2 | 3 });
    }
  }
  return { headings, words: markdown.split(/\s+/).filter(Boolean).length };
}

/** Stamp the prepared ids onto the rendered h1-h3, in document order. */
export function stampHeadingIds(root: HTMLElement, headings: DocHeading[]): HTMLElement[] {
  const els = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3'));
  els.forEach((el, i) => {
    const h = headings[i];
    if (h) {
      el.id = h.id;
      el.style.scrollMarginTop = `${READER_CHROME_OFFSET + 8}px`;
    }
  });
  return els;
}
