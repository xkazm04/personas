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
