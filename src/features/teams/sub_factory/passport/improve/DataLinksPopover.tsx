// The Data-analysis cell's link picker — declares which OTHER registered
// projects post-process this app's internal data (e.g. Brainiac → Pumper).
// User-declared for now, deliberately: neither repo may reference the other in
// code yet, so no honest scan can propose the relation — a future session can
// layer scan-proposed links on top of the same data_links column. Portalled +
// anchored like the module's other popovers.
import { useEffect, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { createPortal } from 'react-dom';
import { GitFork, X } from 'lucide-react';

import { listProjects } from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import { parseDataLinkIds } from '../usePassportData';
import { useImprove } from './ImproveContext';
import { useAnchoredPopover } from './useAnchoredPopover';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

const WIDTH = 300;

export function DataLinksPopover({ slug, anchor, onClose }: {
  slug: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
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
      .catch((err) => { silentCatch('DataLinksPopover:listProjects')(err); if (!cancelled) setOthers([]); });
    return () => { cancelled = true; };
  }, [slug]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(parseDataLinkIds(raw?.project.data_links)));

  const { panelRef, style: popStyle } = useAnchoredPopover({ anchor, width: WIDTH, onClose, active: !!engine && !!raw && !!anchor, layoutKey: others?.length });

  if (!engine || !raw || !anchor) return null;

  const save = async () => {
    setSaving(true);
    try {
      await engine.setDataLinks(slug, [...selected]);
      addToast(selected.size > 0 ? tx(selected.size === 1 ? d.improve_toast_links_one : d.improve_toast_links_other, { count: selected.size }) : d.improve_toast_links_cleared, 'success');
      onClose();
    } catch {
      addToast(d.improve_toast_links_failed, 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      aria-label={tx(d.improve_links_aria, { name: raw.project.name })}
      style={popStyle(anchor)}
      className="fixed z-[9995] outline-none rounded-modal border border-hair bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hair bg-surface-1">
        <GitFork className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption text-ink-2 truncate">{tx(d.improve_links_title, { name: raw.project.name })}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label={t.common.close}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="px-3 pt-2 typo-caption text-ink-3" style={{ fontWeight: 400 }}>
        {d.improve_links_hint}
      </p>

      {others === null ? (
        <p className="px-3 py-4 typo-caption text-ink-3 text-center">{d.improve_links_loading}</p>
      ) : others.length === 0 ? (
        <p className="px-3 py-4 typo-caption text-ink-3 text-center">{d.improve_links_empty}</p>
      ) : (
        <ul className="max-h-52 overflow-y-auto p-1.5">
          {others.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-surface-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                  className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="typo-caption text-ink-2 truncate">{r.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-hair bg-surface-1">
        <Button variant="secondary" size="sm" onClick={save} disabled={saving}>
          {saving ? t.common.saving : d.improve_links_save}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
