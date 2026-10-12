import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { escapeHtml, sanitizeHtmlDocument } from '@/lib/utils/sanitizers/sanitizeHtml';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import type { PersonaReport } from '@/lib/types/types';
import { reportFormat } from './reportHelpers';

/**
 * Open the OS print dialog on a standalone, print-shaped rendering of a report
 * ("Export to PDF" in the report detail modal).
 *
 * It prints the RENDERED document, never the source text:
 *  - `html` reports print their sanitized document (the same profile the
 *    reader frame uses), with a print stylesheet AFTER the document's own so
 *    page margins and colour exactness hold.
 *  - markdown reports are rendered through the same component the reader uses
 *    (`RichMarkdown`, into a detached root, read back as markup) and printed
 *    with a print stylesheet - tables ruled, code set in mono, ```chart bars
 *    drawn. A detached CLIENT root, not `renderToStaticMarkup`: the i18n hook
 *    under RichMarkdown subscribes with `useSyncExternalStore` and no server
 *    snapshot, which the server renderer refuses.
 *
 * Tauri's webview doesn't reliably honour `window.open('', '_blank')` — it
 * either returns null or routes the URL to the system browser. The reliable
 * alternative is an off-screen iframe with `srcdoc`: the iframe lives inside
 * the current webview, so we can call `.contentWindow.print()` on it. The
 * frame is sandboxed `allow-same-origin allow-modals`: the parent can reach
 * its window and `print()` is a modal, while scripts in it stay disabled.
 */
export async function printReport(
  message: PersonaReport,
  labels: { unknownPersona: string; reportLabel: string },
): Promise<void> {
  try {
    const srcdoc = await buildPrintDocument(message, labels);
    openPrintFrame(srcdoc);
  } catch (err) {
    toastCatch('features/overview/sub_reports/libs/reportPrint:print')(err);
  }
}

/**
 * Print stylesheet for a rendered markdown report. The markup carries the
 * app's utility classes, which mean nothing in a standalone frame, so the
 * elements are styled directly - plus the handful of layout utilities the
 * ```chart renderer's bars need to draw at all.
 */
const MARKDOWN_PRINT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.65; max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; }
  header h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .meta { color: #555; font-size: 0.9rem; margin-bottom: 1.75rem; border-bottom: 1px solid #ddd; padding-bottom: 1rem; font-family: system-ui, sans-serif; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 0.5em; page-break-after: avoid; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 0.86em; background: #f5f5f5; border-radius: 3px; }
  code { padding: 0.1rem 0.3rem; }
  pre { padding: 0.75rem; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  pre code { padding: 0; background: none; }
  blockquote { border-left: 3px solid #bbb; padding-left: 1rem; color: #444; }
  a { color: inherit; text-decoration: underline; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #ddd; }
  .flex { display: flex; } .items-center { align-items: center; } .gap-3 { gap: 0.75rem; }
  .flex-1 { flex: 1 1 0%; } .text-right { text-align: right; }
  .w-28 { width: 7rem; flex: none; } .w-14 { width: 3.5rem; flex: none; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .space-y-2 > * + * { margin-top: 0.4rem; }
  .h-6 { height: 0.9rem; background: #eceef1; border-radius: 3px; overflow: hidden; }
  .h-6 > .h-full { height: 100%; background: #3f6e8c; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { margin: 1.5cm; }
`;

/** Appended AFTER an html report's own styles: page geometry only. */
const HTML_PRINT_CSS = `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img, video, svg { max-width: 100%; }
  table, figure, pre { page-break-inside: avoid; }
  @page { margin: 1.5cm; }
`;

export async function buildPrintDocument(
  message: PersonaReport,
  labels: { unknownPersona: string; reportLabel: string },
): Promise<string> {
  const title = escapeHtml(message.title || labels.reportLabel);
  const content = message.content ?? '';

  if (reportFormat(message.content_type) === 'html') {
    const doc = new DOMParser().parseFromString(sanitizeHtmlDocument(content), 'text/html');
    if (!doc.title) doc.title = message.title || labels.reportLabel;
    const style = doc.createElement('style');
    style.textContent = HTML_PRINT_CSS;
    doc.head.appendChild(style);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  }

  const body = renderMarkdownToHtml(content);
  const persona = escapeHtml(message.persona_name || labels.unknownPersona);
  const when = escapeHtml(new Date(message.created_at).toLocaleString());
  // The rendered markup comes from React (text escaped, no raw HTML: the
  // markdown pipeline has no rehype-raw), and it is sanitized once more as a
  // document before it reaches the frame.
  return sanitizeHtmlDocument(`<!doctype html>
<html><head><title>${title}</title><style>${MARKDOWN_PRINT_CSS}</style></head>
<body>
  <header><h1>${title}</h1><div class="meta">${persona} · ${when}</div></header>
  <main>${body}</main>
</body></html>`);
}

/** Render a markdown report through RichMarkdown into a detached element and
 *  return the markup it committed. */
function renderMarkdownToHtml(content: string): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(RichMarkdown, { content, variant: 'document' })));
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}

function openPrintFrame(srcdoc: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  iframe.srcdoc = srcdoc;

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    // Tear-down on afterprint (modern browsers fire this on Save-as-PDF
    // success AND cancel). Belt-and-braces timeout in case afterprint
    // doesn't reach us.
    const cleanup = () => {
      try { iframe.remove(); } catch (err) { silentCatch("features/overview/sub_reports/libs/reportPrint:cleanup")(err); }
    };
    win.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(cleanup, 120_000);
    // Print dialog must be invoked from the iframe's window context — calling
    // print() on the host page would print the app, not the report.
    win.focus();
    win.print();
  };

  document.body.appendChild(iframe);
}
