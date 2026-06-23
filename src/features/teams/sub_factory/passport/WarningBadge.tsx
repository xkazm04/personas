// Per-project "needs your attention" badge — folds the old AttentionBand into the
// matrix. Sits next to a project's title: a warning icon + the count of off-track
// KPIs. Click → an anchored popover (portalled, so the matrix's overflow-x-auto
// never clips it) listing each off-track signal; clicking one deep-links into that
// KPI's console. Mirrors QuickEditPopover's positioning, minus the edit footer.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';

export interface WarningItem {
  groupId: string;
  kpiId: string;
  name: string;
  current: number | null;
  target: number;
  unit: string;
}

const WIDTH = 280;

export function WarningBadge({
  projectName,
  items,
  onJump,
}: {
  projectName: string;
  items: WarningItem[];
  /** Deep-link into the off-track KPI's console (skips the drill-down). */
  onJump?: (groupId: string, kpiId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        aria-label={`${items.length} off-track signals — needs attention`}
        className="inline-flex items-center gap-0.5 rounded-input border border-red-500/40 bg-red-500/12 hover:bg-red-500/20 px-1 py-0.5 transition-colors flex-shrink-0"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-red-400" aria-hidden />
        <span className="typo-caption tabular-nums font-semibold text-red-400">{items.length}</span>
      </button>
      <WarningPopover
        open={open}
        anchor={anchor}
        projectName={projectName}
        items={items}
        onClose={() => setOpen(false)}
        onJump={(g, k) => { setOpen(false); onJump?.(g, k); }}
      />
    </>
  );
}

function WarningPopover({
  open, anchor, projectName, items, onClose, onJump,
}: {
  open: boolean;
  anchor: DOMRect | null;
  projectName: string;
  items: WarningItem[];
  onClose: () => void;
  onJump: (groupId: string, kpiId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 200;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow
      ? Math.max(8, anchor.top - panelH - 6)
      : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  if (!open || !anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${projectName} — needs attention`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-red-500/[0.06]">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">{projectName}</span>
        <span className="typo-caption text-foreground/55 ml-auto whitespace-nowrap">{items.length} off track</span>
      </div>
      <ul className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
        {items.map((it) => (
          <li key={it.kpiId}>
            <button
              type="button"
              onClick={() => onJump(it.groupId, it.kpiId)}
              className="group/w w-full text-left rounded-interactive px-2 py-1.5 flex items-center gap-2 transition-colors hover:bg-red-500/10"
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" aria-hidden />
              <span className="typo-caption text-foreground min-w-0 flex-1 truncate">{it.name}</span>
              <span className="typo-caption tabular-nums text-foreground/60 flex-shrink-0">{it.current ?? '—'}/{it.target}{it.unit}</span>
              <ArrowUpRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/w:opacity-100 text-primary/70 transition-opacity" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
