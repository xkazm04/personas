import { silentCatch } from '@/lib/silentCatch';
import type { PersonaReport } from '@/lib/types/types';

/**
 * Open the OS print dialog on a standalone, print-shaped rendering of a report
 * ("Export to PDF" in the report detail modal).
 *
 * Tauri's webview doesn't reliably honour `window.open('', '_blank')` — it
 * either returns null or routes the URL to the system browser (where the empty
 * document path can't be written to). The reliable alternative is an off-screen
 * iframe with `srcdoc`: the iframe lives inside the current webview, so we can
 * call `.contentWindow.print()` on it and the OS print dialog opens against
 * that document.
 */
export function printReport(
  message: PersonaReport,
  labels: { unknownPersona: string; reportLabel: string },
): void {
  const personaName = message.persona_name || labels.unknownPersona;
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const safeTitle = escape(message.title || labels.reportLabel);
  const safeBody = escape(message.content ?? '');
  const safePersona = escape(personaName);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  iframe.srcdoc = `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; line-height: 1.7; max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 1rem; }
  pre, code { background: #f5f5f5; padding: 0.1rem 0.35rem; border-radius: 3px; font-family: ui-monospace, monospace; }
  pre { padding: 0.75rem; overflow-x: auto; }
  blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding-left: 1rem; color: #444; }
  .body { white-space: pre-wrap; }
  @page { margin: 1.5cm; }
</style></head>
<body>
  <h1>${safeTitle}</h1>
  <div class="meta">From ${safePersona} · ${new Date(message.created_at).toLocaleString()}</div>
  <div class="body">${safeBody}</div>
</body></html>`;

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
    // Print dialog must be invoked synchronously from the iframe's window
    // context — calling print() on the host page would print the app, not the
    // message.
    win.focus();
    win.print();
  };

  document.body.appendChild(iframe);
}
