// @catalog HtmlDocumentFrame - renders an agent-authored HTML/CSS document sanitized inside a script-free sandboxed iframe that grows to its content (long-form reports, council reports).
/**
 * HtmlDocumentFrame — the ONE place agent-written HTML reaches the screen.
 *
 * Three walls, each meant to hold on its own:
 *  1. `sanitizeHtmlDocument` (src/lib/utils/sanitizers/sanitizeHtml.ts) strips
 *     scripts, frames, forms, `<base>`/`<meta>`/`<link>`, every `on*`
 *     attribute and every URL that is not inline or app-local. Remote URLs are
 *     REMOVED, not merely left for the CSP to block.
 *  2. The iframe is sandboxed WITHOUT `allow-scripts`, so a sanitizer miss
 *     still cannot execute.
 *  3. The app CSP is inherited by a `srcdoc` frame: inline `<style>` works,
 *     inline `<script>` and remote hosts do not.
 *
 * Relative media (`<img src="shots/a.png">`) is resolved through
 * `resolveMedia` to `blob:`/`data:` URLs before the document is built; what
 * does not resolve is dropped, so nothing renders broken. Until resolution
 * settles and the frame has measured itself, a calm ghost holds the space.
 *
 * Static sanitized HTML is not an embedded app: there is no bridge, no
 * postMessage protocol and no script on either side of the frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  prependDocumentStyle,
  resolveDocumentMedia,
  sanitizeHtmlDocument,
} from '@/lib/utils/sanitizers/sanitizeHtml';
import { silentCatch } from '@/lib/silentCatch';
import { themeBridgeCss } from './htmlDocumentTheme';
import { DocumentGhost } from './DocumentGhost';

export interface HtmlDocumentFrameProps {
  /** The agent-authored document: a full page or a fragment. */
  html: string;
  /** Accessible name for the frame. Pre-translated. */
  title: string;
  /**
   * Resolve a local media reference (an `<img src>` / `<video src>` that names
   * a file in the producer's run directory) to a `blob:`/`data:` URL. Absent:
   * local references are dropped. Read once per `html`; the frame does not
   * re-resolve when only the function's identity changes.
   */
  resolveMedia?: (src: string) => Promise<string | null>;
  className?: string;
}

/**
 * SANDBOX CHOICE: `allow-same-origin`, and nothing else.
 *
 * `sandbox=""` would make the document an opaque origin, and the parent could
 * not read its height - the frame would need a fixed height and an inner
 * scrollbar inside the reader's own scroll. `allow-same-origin` WITHOUT
 * `allow-scripts` lets the parent measure the document while scripting in
 * the frame stays disabled: the dangerous pair is `allow-scripts` +
 * `allow-same-origin` together (a script could then remove its own sandbox),
 * and `allow-scripts` is never granted here. No forms, popups, modals or top
 * navigation either. Scripts were already stripped by the sanitizer; this is
 * the wall behind it.
 */
const FRAME_SANDBOX = 'allow-same-origin';

/** Content height of a same-origin frame document, in CSS px. */
function measure(frame: HTMLIFrameElement | null): number {
  const doc = frame?.contentDocument;
  if (!doc?.documentElement) return 0;
  const rect = doc.documentElement.getBoundingClientRect().height;
  return Math.ceil(rect || doc.documentElement.scrollHeight || 0);
}

export function HtmlDocumentFrame({ html, title, resolveMedia, className }: HtmlDocumentFrameProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const resolveRef = useRef(resolveMedia);
  resolveRef.current = resolveMedia;

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setHeight(null);
    resolveDocumentMedia(sanitizeHtmlDocument(html), resolveRef.current)
      .then((doc) => {
        if (!cancelled) setSrcDoc(prependDocumentStyle(doc, themeBridgeCss()));
      })
      .catch(silentCatch('features/shared/components/document/HtmlDocumentFrame:build'));
    return () => {
      cancelled = true;
    };
  }, [html]);

  // Auto-height: measured on load, then kept in step with the document's own
  // reflows (late images, fonts, a resized reader). The observer and the
  // listener are the PARENT's, observing a same-origin document; nothing runs
  // inside the frame.
  const cleanupRef = useRef<(() => void) | null>(null);
  const onLoad = useCallback(() => {
    cleanupRef.current?.();
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const remeasure = () => setHeight(measure(frameRef.current));
    remeasure();
    if (!doc?.documentElement) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(doc.documentElement);
    doc.addEventListener('load', remeasure, true);
    cleanupRef.current = () => {
      observer?.disconnect();
      doc.removeEventListener('load', remeasure, true);
    };
  }, []);
  useEffect(() => () => cleanupRef.current?.(), []);

  const ready = srcDoc !== null && height !== null;
  return (
    <div className="relative">
      {!ready && <DocumentGhost testId="html-document-ghost" />}
      {srcDoc !== null && (
        <iframe
          ref={frameRef}
          title={title}
          sandbox={FRAME_SANDBOX}
          srcDoc={srcDoc}
          onLoad={onLoad}
          referrerPolicy="no-referrer"
          scrolling="no"
          className={`block w-full border-0 bg-transparent overflow-hidden ${className ?? ''}`}
          style={
            ready
              ? { height: Math.max(height, 1) }
              : { height: 0, visibility: 'hidden', position: 'absolute', inset: 0 }
          }
        />
      )}
    </div>
  );
}
