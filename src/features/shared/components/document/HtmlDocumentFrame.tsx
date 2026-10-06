// @catalog HtmlDocumentFrame - renders an agent-authored HTML/CSS document sanitized inside a script-free sandboxed iframe (long-form reports, council reports).
/**
 * HtmlDocumentFrame — the ONE place agent-written HTML reaches the screen.
 *
 * Three walls, each independent of the others:
 *  1. DOMPurify strips scripts, event-handler attributes and anything that is
 *     not a document tag before the markup reaches the frame.
 *  2. The iframe is `sandbox=""` — no scripts, no same-origin, no forms, no
 *     top navigation — so a sanitizer miss still cannot execute or reach the
 *     host.
 *  3. The app CSP is inherited by a `srcdoc` frame: inline `<style>` works,
 *     inline `<script>` and remote hosts do not.
 *
 * WP0 minimal version (decision-center spark): sanitize + sandboxed srcdoc.
 * Package R1 hardens it — the document sanitizer profile, auto-height, theme
 * variables, a media resolver for local run-dir assets, and tests.
 */
import { useMemo } from 'react';
import DOMPurify from 'dompurify';

export interface HtmlDocumentFrameProps {
  /** The agent-authored document: a full page or a fragment. */
  html: string;
  /** Accessible name for the frame. Pre-translated. */
  title: string;
  /**
   * Resolve a local media reference (an `<img src>` / `<video src>` that names
   * a file in the producer's run directory) to a `blob:`/`data:` URL. Absent:
   * local references are dropped.
   */
  resolveMedia?: (src: string) => Promise<string | null>;
  className?: string;
}

function sanitizeDocument(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
    FORBID_ATTR: ['srcset', 'ping', 'formaction'],
  });
}

export function HtmlDocumentFrame({ html, title, className }: HtmlDocumentFrameProps) {
  const srcDoc = useMemo(() => sanitizeDocument(html), [html]);
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={srcDoc}
      className={className ?? 'block w-full min-h-[60vh] border-0 bg-transparent'}
      referrerPolicy="no-referrer"
    />
  );
}
