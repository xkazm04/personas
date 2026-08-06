// The "Deploy Claude Code" popover (P3) — for code-requiring gaps (context graph,
// CLAUDE.md, tests, observability). Surfaces the applicable golden-standard
// upgrade actions for a row: a context SCAN, or a Claude-Code TASK whose precise
// prompt is previewable. Queue (safe, review-then-run) or Deploy now (runs the
// CLI; auto-PRs on green). Portalled + anchored like the other improve popovers.
//
// The BODY lives in `ImproveClassicPanel` — the Database and Monitoring modals
// carry the same content, and it must not exist twice. This file is now the
// positioned shell: placement, dismissal, chrome.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rocket, X } from 'lucide-react';

import { useImprove } from './ImproveContext';
import { hasClassicContent, ImproveClassicPanel } from './ImproveClassicPanel';

const WIDTH = 442; // 340 +30% — roomier body for the icon-grid connector section

export function DeployPopover({
  slug, rowKey, anchor, onClose,
}: {
  slug: string;
  rowKey: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const engine = useImprove();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const raw = engine?.getRaw(slug);

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 240;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow ? Math.max(8, anchor.top - panelH - 6) : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  if (!engine || !raw || !anchor || !hasClassicContent(slug, rowKey, engine)) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Deploy upgrade for ${raw.project.name}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <Rocket className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">Upgrade {raw.project.name}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 max-h-[420px] overflow-y-auto">
        <ImproveClassicPanel slug={slug} rowKey={rowKey} onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}
