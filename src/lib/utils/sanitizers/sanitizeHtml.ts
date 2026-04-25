import DOMPurify from 'dompurify';

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
