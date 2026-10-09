// A council report.md -> HTML, for the self-contained browser report.
//
// PARSE with what the repo already ships, EMIT by hand. `unified` + `remark-parse`
// come with `react-markdown` (a direct dependency) and `remark-gfm` is direct, so
// the tree is CommonMark + GFM tables without a new package. The emitter is ours
// because the report needs DESIGNED output (claims, cite chips, numeric cells)
// that a stock HTML stringifier cannot give, and because every text node and
// attribute is escaped here - a member's finding is untrusted text, and raw HTML
// in report.md is printed as text, never passed through.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for an HTML text node or a double-quoted attribute. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** A file reference: `path/to/file.ts:12-30`, `:80`, `file.md`. */
const CITE_RE =
  /^(?:[\w@.~\-[\]()/]+\.(?:tsx?|jsx?|mjs|cjs|rs|py|md|json|jsonl|sql|css|ya?ml|toml|sh|html)(?::\d+(?:[-,:]\d+)*)?|:\d+(?:[-,]\d+)*)$/;
const SHA_RE = /^[0-9a-f]{7,64}(?:…|\.\.\.)?$/;

/** The class an inline code span earns from its content. */
export function codeClass(text) {
  const t = text.trim();
  if (CITE_RE.test(t)) return 'cite';
  if (SHA_RE.test(t)) return 'sha';
  return 'code';
}

/** Only these URL shapes survive into an href; everything else is dropped to text. */
function safeHref(url) {
  const u = String(url ?? '').trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (u.startsWith('#')) return u;
  return null;
}

export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

/** Plain text of an mdast node. */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value ?? '';
  if (Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
}

const NUMERIC_RE = /^[−+\-~≈]?\d[\d.,]*\s?(?:%|s|ms|min|k|×)?$/;
const CELL_TONES = [
  [/^(?:unmeasured|n\/a|-|–|—|none)$/i, 'dim'],
  [/^(?:pass|ready|held|resolved|closed|conformant)\b/i, 'good'],
  [/^(?:fail|failed|yes, binding|binding)\b/i, 'bad'],
];

function cellTone(text) {
  const t = text.trim();
  if (NUMERIC_RE.test(t)) return 'num';
  for (const [re, tone] of CELL_TONES) if (re.test(t)) return tone;
  return '';
}

class Emitter {
  constructor() {
    this.ids = new Map();
  }

  uniqueId(base) {
    const n = this.ids.get(base) ?? 0;
    this.ids.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  }

  children(node, ctx) {
    return (node.children ?? []).map((c) => this.node(c, ctx)).join('');
  }

  node(n, ctx = {}) {
    switch (n.type) {
      case 'text':
        return esc(n.value);
      case 'strong':
        return `<strong>${this.children(n, ctx)}</strong>`;
      case 'emphasis':
        return `<em>${this.children(n, ctx)}</em>`;
      case 'delete':
        return `<del>${this.children(n, ctx)}</del>`;
      case 'inlineCode':
        return `<code class="${codeClass(n.value)}">${esc(n.value)}</code>`;
      case 'break':
        return '<br>';
      case 'link': {
        const href = safeHref(n.url);
        const inner = this.children(n, ctx);
        if (!href) return inner;
        const ext = /^https?:/i.test(href) ? ' rel="noreferrer noopener" target="_blank"' : '';
        return `<a href="${esc(href)}"${ext}>${inner}</a>`;
      }
      case 'image':
        // No network: an image becomes its alt text and, when safe, a link.
        return safeHref(n.url)
          ? `<a href="${esc(safeHref(n.url))}" rel="noreferrer noopener">${esc(n.alt || n.url)}</a>`
          : esc(n.alt || '');
      case 'html':
        return `<code class="code">${esc(n.value)}</code>`;
      case 'paragraph': {
        const inner = this.children(n, ctx);
        // A short top-level paragraph that opens in bold is a load-bearing
        // claim and gets the claim treatment; a long one stays body text.
        const lead = ctx.top && n.children?.[0]?.type === 'strong' && textOf(n).length <= 420;
        return lead ? `<p class="lede">${inner}</p>` : `<p>${inner}</p>`;
      }
      case 'heading': {
        const level = Math.min(Math.max(n.depth + (ctx.shift ?? 0), 2), 5);
        const id = this.uniqueId(`md-${slugify(textOf(n))}`);
        return `<h${level} id="${id}">${this.children(n, ctx)}</h${level}>`;
      }
      case 'blockquote':
        return `<blockquote class="quote">${this.children(n, { ...ctx, top: false })}</blockquote>`;
      case 'code': {
        const lang = n.lang ? `<span class="lang">${esc(n.lang)}</span>` : '';
        return `<pre class="block">${lang}<code>${esc(n.value)}</code></pre>`;
      }
      case 'thematicBreak':
        return '<hr class="rule">';
      case 'list': {
        const tag = n.ordered ? 'ol' : 'ul';
        const start = n.ordered && n.start != null && n.start !== 1 ? ` start="${Number(n.start)}"` : '';
        const cls = ctx.top && n.ordered ? ' class="numbered"' : '';
        return `<${tag}${start}${cls}>${this.children(n, { ...ctx, top: false, tight: !n.spread })}</${tag}>`;
      }
      case 'listItem': {
        const check = n.checked == null ? '' : `<span class="check ${n.checked ? 'on' : ''}">${n.checked ? '✓' : ''}</span>`;
        // A tight list's paragraphs render without <p> so items stay compact.
        const inner = (n.children ?? [])
          .map((c) => (c.type === 'paragraph' && !n.spread ? this.children(c, ctx) : this.node(c, ctx)))
          .join('');
        return `<li>${check}${inner}</li>`;
      }
      case 'table':
        return this.table(n, ctx);
      case 'footnoteReference':
        return `<sup class="fn">[${esc(n.label ?? n.identifier)}]</sup>`;
      case 'footnoteDefinition':
        return `<div class="footnote"><sup>[${esc(n.label ?? n.identifier)}]</sup> ${this.children(n, ctx)}</div>`;
      default:
        return n.children ? this.children(n, ctx) : esc(n.value ?? '');
    }
  }

  table(n, ctx) {
    const align = n.align ?? [];
    const [head, ...rows] = n.children ?? [];
    const headCells = head?.children ?? [];
    // A header row of empty cells (the `| | |` key/value idiom) is dropped and
    // the table is drawn as a definition grid instead.
    const emptyHead = headCells.every((c) => textOf(c).trim() === '');
    const th = emptyHead
      ? ''
      : `<thead><tr>${headCells
          .map((c, i) => `<th${align[i] ? ` style="text-align:${align[i]}"` : ''}>${this.children(c, ctx)}</th>`)
          .join('')}</tr></thead>`;
    const body = rows
      .map(
        (r) =>
          `<tr>${(r.children ?? [])
            .map((c, i) => {
              const tone = cellTone(textOf(c));
              const cls = [tone ? `t-${tone}` : '', emptyHead && i === 0 ? 'key' : ''].filter(Boolean).join(' ');
              const style = align[i] ? ` style="text-align:${align[i]}"` : '';
              return `<td${cls ? ` class="${cls}"` : ''}${style}>${this.children(c, ctx)}</td>`;
            })
            .join('')}</tr>`,
      )
      .join('');
    return `<div class="table-wrap"><table class="${emptyHead ? 'kv' : 'grid'}">${th}<tbody>${body}</tbody></table></div>`;
  }
}

/**
 * Parse report.md and split it into the preamble (everything before the first
 * level-2 heading, minus the level-1 title) and one section per level-2 heading.
 * Returns `{ title, preamble, sections: [{ id, title, html }] }`.
 */
export function renderReportMarkdown(md) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md);
  const em = new Emitter();
  let title = null;
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const child of tree.children) {
    if (child.type === 'heading' && child.depth === 1 && title == null) {
      title = textOf(child);
      continue;
    }
    if (child.type === 'heading' && child.depth <= 2) {
      const raw = textOf(child).trim();
      const clean = raw.replace(/^\d+[.)]\s+/, '');
      cur = { id: em.uniqueId(`r-${slugify(clean)}`), title: clean, titleHtml: em.children(child, {}), parts: [] };
      sections.push(cur);
      continue;
    }
    // Headings below a section render one level down so h2 stays the section's.
    const html = em.node(child, { top: true, shift: 0 });
    (cur ? cur.parts : preamble).push(html);
  }
  return {
    title,
    preamble: preamble.join('\n'),
    sections: sections.map((s) => ({ id: s.id, title: s.title, titleHtml: s.titleHtml, html: s.parts.join('\n') })),
  };
}

/**
 * Plain text from a member's JSON (a finding's detail, an evidence caption):
 * escaped, backtick spans and file:line references drawn as code chips, blank
 * lines and `\n` kept as paragraph breaks.
 */
export function richText(s, { inline = false } = {}) {
  const raw = inline ? String(s ?? '').replace(/\s*\n+\s*/g, ' ') : String(s ?? '');
  const out = [];
  const parts = raw.split(/(`[^`\n]+`)/g);
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const v = part.slice(1, -1);
      out.push(`<code class="${codeClass(v)}">${esc(v)}</code>`);
      continue;
    }
    out.push(
      esc(part).replace(
        /(^|[\s(\[,;])((?:[\w@.~\-[\]]+\/)*[\w@.\-[\]]+\.(?:tsx?|jsx?|mjs|cjs|rs|py|md|json|jsonl|sql|css|ya?ml|toml)(?![\w-])(?::\d+(?:[-,]\d+)*)?)/g,
        (_, pre, ref) => `${pre}<code class="cite">${ref}</code>`,
      ),
    );
  }
  if (inline) return out.join('').trim();
  return out
    .join('')
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join('');
}
