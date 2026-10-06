import DOMPurify from 'dompurify';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Sanitize HTML produced by highlight.js before passing to dangerouslySetInnerHTML.
 *
 * Only allows `<span>` tags with `class` attributes matching the `hljs-*` pattern.
 * All other tags, attributes, and potential script injection vectors are stripped
 * by DOMPurify.
 */
export function sanitizeHljsHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
  });
}

/**
 * Strip all HTML tags from a string, returning only the text content.
 *
 * Used as a defence-in-depth layer for AI-generated content (e.g. persona
 * memories) that is rendered as React text nodes. While React auto-escapes
 * text content, stripping HTML at display time ensures safety even if the
 * rendering approach changes in the future.
 */
export function stripHtml(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape HTML special characters in a string for safe interpolation into HTML
 * fragments that will reach `dangerouslySetInnerHTML`.
 */
export function escapeHtml(input: string): string {
  return input.replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPE_MAP[c]!);
}

/**
 * Render LLM/user-supplied summary text with `**bold**` markdown converted to
 * `<strong>`, then DOMPurify-sanitised. Use this for any summary string that
 * flows into `dangerouslySetInnerHTML` so injected `<script>`, `<img onerror>`,
 * or attribute-based JS is stripped before render.
 */
export function sanitizeRichSummary(input: string, strongClass = 'text-foreground/90'): string {
  const escaped = escapeHtml(input);
  const withBold = escaped.replace(
    /\*\*(.*?)\*\*/g,
    `<strong class="${strongClass}">$1</strong>`,
  );
  return DOMPurify.sanitize(withBold, {
    ALLOWED_TAGS: ['strong'],
    ALLOWED_ATTR: ['class'],
  });
}

// ---------------------------------------------------------------------------
// Agent-authored HTML DOCUMENTS (long-form reports, council reports).
//
// The profile behind `HtmlDocumentFrame`. A whole document survives - `<style>`,
// tables, figures, media, basic SVG - and everything that could execute, load
// from elsewhere or navigate is removed HERE, not left for the frame's sandbox
// or the app CSP to block. Each wall is meant to hold on its own.
// ---------------------------------------------------------------------------

/** Tags that never reach a document frame. `meta` goes whole: a refresh or a
 *  CSP override is `http-equiv`, and `charset` is meaningless in `srcdoc`. */
const DOCUMENT_FORBID_TAGS = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
  'form', 'base', 'meta', 'link', 'noscript',
];

/** Attributes that load or navigate; each value is classified below. */
const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'background', 'cite', 'action', 'data']);

/** Elements whose `href` is navigation, not a resource. Only an in-document
 *  fragment survives on them: a relative path is not a page this frame has. */
const LINK_TAGS = new Set(['a', 'area']);

/**
 * How a document URL is treated.
 *  - `keep`:  inline or app-local already (`data:` media, `blob:`, the asset
 *             protocol, a `#fragment`).
 *  - `local`: a RELATIVE path - a file beside the document in its producer's
 *             directory, resolvable only through the frame's `resolveMedia`.
 *  - `drop`:  everything else, remote hosts and `javascript:` included.
 */
export type DocumentUrlKind = 'keep' | 'local' | 'drop';

const DATA_MEDIA_RE = /^data:(?:image|video|audio|font)\//i;
const ASSET_RE = /^(?:asset:|https?:\/\/asset\.localhost(?:[/:?#]|$))/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Browsers ignore whitespace and control characters inside a scheme
 *  (`java\nscript:`), so classification runs on the squeezed value. */
function squeezeUrl(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

export function classifyDocumentUrl(raw: string): DocumentUrlKind {
  const url = squeezeUrl(raw);
  if (url === '') return 'drop';
  if (url.startsWith('#')) return 'keep';
  if (/^blob:/i.test(url)) return 'keep';
  if (ASSET_RE.test(url)) return 'keep';
  if (/^data:/i.test(url)) return DATA_MEDIA_RE.test(url) ? 'keep' : 'drop';
  if (SCHEME_RE.test(url)) return 'drop';
  // Protocol-relative (`//host`), root-absolute (`/x` would resolve against
  // the app's own origin) and backslash forms are not a sibling file.
  if (url.startsWith('/') || url.startsWith('\\')) return 'drop';
  return 'local';
}

/** Remove every remote or unresolvable reference from a CSS text: `@import`
 *  goes whole, a `url()` that is not inline/app-local becomes `none`. */
export function sanitizeDocumentCss(css: string): string {
  return css
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole: string, _q: string, url: string) =>
      classifyDocumentUrl(url) === 'keep' && !url.trim().startsWith('#') ? whole : 'none',
    );
}

type Purifier = ReturnType<typeof DOMPurify>;
let documentPurifier: Purifier | null = null;

/**
 * A DEDICATED DOMPurify instance: the hooks below rewrite URLs and CSS, and
 * hooks registered on the shared default instance would also run inside every
 * other sanitizer in this file.
 */
function getDocumentPurifier(): Purifier {
  if (documentPurifier) return documentPurifier;
  const purifier = DOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const name = data.attrName.toLowerCase();
    if (name.startsWith('on')) {
      data.keepAttr = false;
      return;
    }
    if (name === 'style') {
      data.attrValue = sanitizeDocumentCss(data.attrValue);
      return;
    }
    if (!URL_ATTRS.has(name)) return;
    const kind = classifyDocumentUrl(data.attrValue);
    const isLink = LINK_TAGS.has(node.nodeName.toLowerCase()) && name === 'href';
    if (kind === 'drop' || (isLink && !squeezeUrl(data.attrValue).startsWith('#'))) {
      data.keepAttr = false;
    }
  });
  purifier.addHook('afterSanitizeElements', (node) => {
    if (node.nodeName.toLowerCase() === 'style' && node.textContent) {
      node.textContent = sanitizeDocumentCss(node.textContent);
    }
  });
  documentPurifier = purifier;
  return purifier;
}

/**
 * Sanitize an agent-authored HTML document (a full page or a fragment) for a
 * script-free frame. Returns a complete document with a doctype, so the frame
 * renders in standards mode. Relative media references are KEPT here - they
 * are resolved (or dropped) by {@link resolveDocumentMedia}.
 */
export function sanitizeHtmlDocument(html: string): string {
  const clean = getDocumentPurifier().sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: DOCUMENT_FORBID_TAGS,
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'http-equiv'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  return `<!doctype html>\n${clean}`;
}

/** Media attributes a relative reference can sit in. */
const MEDIA_ATTRS = ['src', 'poster', 'href', 'xlink:href'] as const;

/**
 * Resolve every relative media reference in a SANITIZED document through
 * `resolve` (a run-dir reader returning a `blob:`/`data:` URL), and drop what
 * does not resolve. Without a resolver every local reference is dropped. A
 * resolver's answer is re-classified: only an inline/app-local URL is
 * accepted, so a resolver cannot reintroduce a remote host.
 */
export async function resolveDocumentMedia(
  documentHtml: string,
  resolve?: (src: string) => Promise<string | null>,
): Promise<string> {
  const doc = new DOMParser().parseFromString(documentHtml, 'text/html');
  const refs: { el: Element; attr: string; value: string }[] = [];
  for (const el of Array.from(doc.querySelectorAll('[src],[poster],[href],[xlink\\:href]'))) {
    for (const attr of MEDIA_ATTRS) {
      const value = el.getAttribute(attr);
      if (value != null && classifyDocumentUrl(value) === 'local') refs.push({ el, attr, value });
    }
  }
  if (refs.length === 0) return documentHtml;

  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...new Set(refs.map((r) => r.value))].map(async (value) => {
      let url: string | null;
      try {
        url = resolve ? await resolve(value) : null;
      } catch (err) {
        // An unreadable file is an absent one: the reference is dropped below,
        // which is the frame's documented behaviour for an unresolved ref.
        silentCatch('lib/utils/sanitizers/sanitizeHtml:resolveDocumentMedia')(err);
        url = null;
      }
      resolved.set(value, url && classifyDocumentUrl(url) === 'keep' ? url : null);
    }),
  );

  for (const { el, attr, value } of refs) {
    const url = resolved.get(value);
    if (url) el.setAttribute(attr, url);
    else el.removeAttribute(attr);
  }
  // Nothing broken on screen: an image or source left with no source goes,
  // and so does a player left with nothing to play.
  for (const el of Array.from(doc.querySelectorAll('img,source,image,track'))) {
    if (!MEDIA_ATTRS.some((a) => a !== 'poster' && el.hasAttribute(a))) el.remove();
  }
  for (const el of Array.from(doc.querySelectorAll('video,audio'))) {
    if (!el.hasAttribute('src') && !el.querySelector('source')) el.remove();
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** Insert a `<style>` as the FIRST thing in the document head, so every rule
 *  the document itself carries comes later in the cascade and wins. */
export function prependDocumentStyle(documentHtml: string, css: string): string {
  const doc = new DOMParser().parseFromString(documentHtml, 'text/html');
  const style = doc.createElement('style');
  style.setAttribute('data-pa-theme', '');
  style.textContent = css;
  doc.head.insertBefore(style, doc.head.firstChild);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
