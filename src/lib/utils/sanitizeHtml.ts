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
