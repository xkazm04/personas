// The Data-analysis cell's link picker — declares which OTHER registered
// projects post-process this app's internal data (e.g. Brainiac → Pumper).
// User-declared for now, deliberately: neither repo may reference the other in
// code yet, so no honest scan can propose the relation — a future session can
// layer scan-proposed links on top of the same data_links column. Portalled +
// anchored like the module's other popovers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitFork, X } from 'lucide-react';

import { listProjects } from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import { anchorTip } from '../passportInk';
import { parseDataLinkIds } from '../usePassportData';
import { useImprove } from './ImproveContext';

const WIDTH = 300;

export function DataLinksPopover({ slug, anchor, onClose }: {
  slug: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const panelRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const raw = engine?.getRaw(slug);
  // ALL registered projects — deliberately wider than the wall's cross-scanned
  // set: a data-processing sibling (e.g. Pumper) may be registered without
  // ever having been context-scanned onto the wall.
  const [others, setOthers] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (cancelled) return;
        setOthers(rows.filter((r) => r.id !== slug).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => { if (!cancelled) setOthers([]); });
    return () => { cancelled = true; };
  }, [slug]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(parseDataLinkIds(raw?.project.data_links)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  // useLayoutEffect keeps parity with the sibling popovers' flip/clamp behavior.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    setPos(anchorTip(anchor, WIDTH, panelRef.current?.offsetHeight ?? 260));
  }, [anchor]);

  if (!engine || !raw || !anchor) return null;

  const save = async () => {
    setSaving(true);
    try {
      await engine.setDataLinks(slug, [...selected]);
      addToast(selected.size > 0 ? `Linked ${selected.size} data ${selected.size === 1 ? 'project' : 'projects'}` : 'Data links cleared', 'success');
      onClose();
    } catch {
      addToast('Couldn’t save the data links', 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Data-analysis links for ${raw.project.name}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <GitFork className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">Data analysis — {raw.project.name}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="px-3 pt-2 typo-caption text-foreground/55 leading-snug" style={{ fontWeight: 400 }}>
        Which registered projects post-process this app’s data? Declared by hand for now — a future
        scan may propose links once the connection exists in code.
      </p>

      {others === null ? (
        <p className="px-3 py-4 typo-caption text-foreground/45 text-center">Loading projects…</p>
      ) : others.length === 0 ? (
        <p className="px-3 py-4 typo-caption text-foreground/45 text-center">No other registered projects to link.</p>
      ) : (
        <ul className="max-h-52 overflow-y-auto p-1.5">
          {others.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/[0.04] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                  className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="typo-caption font-medium text-foreground truncate">{r.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-primary/10 bg-secondary/10">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save links'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
