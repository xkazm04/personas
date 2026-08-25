// Watchtower routing popover — pin a Marketplace feed to the dev projects a
// firing should dispatch impact sessions into. Portalled + anchored like the
// passport module's popovers (model: teams/sub_factory/passport/improve/
// DataLinksPopover.tsx); routes save as a whole set via
// shared_events_set_project_routes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Route, X } from 'lucide-react';

import { listProjects } from '@/api/devTools/devTools';
import { useAppKeyboard, OVERLAY_DISMISS_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import * as api from '@/api/events/sharedEvents';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

const WIDTH = 300;

export function FeedRoutingPopover({ entry, anchor, routedProjectIds, onClose, onSaved }: {
  entry: SharedEventCatalogEntry;
  anchor: DOMRect;
  routedProjectIds: string[];
  onClose: () => void;
  /** Called after a successful save with the new routed set. */
  onSaved: (projectIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const addToast = useToastStore((s) => s.addToast);
  const panelRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  // A failed roster load must stay distinguishable from an empty roster —
  // the failure gets its own state, never an empty-array disguise.
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => {
        silentCatch('features/triggers/sub_shared/FeedRoutingPopover:listProjects')(err);
        if (!cancelled) setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(routedProjectIds));

  // Escape goes through the app keyboard ladder (focus-management golden path)
  // at BaseModal's overlay priority, so the press closes only this popover and
  // never a second surface underneath it.
  useAppKeyboard(
    (e) => {
      if (e.key === 'Escape') {
        onClose();
        return true;
      }
    },
    { priority: OVERLAY_DISMISS_PRIORITY },
  );
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // Anchored placement with viewport clamp + upward flip, matching the sibling
  // popovers' behavior without importing the passport module's helper.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const height = panelRef.current?.offsetHeight ?? 280;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - WIDTH - 8);
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPos({ top, left });
  }, [anchor, projects]);

  const save = async () => {
    // Reconcile the selection against the live roster (bulk-selection-actions
    // golden path): a checked id whose project no longer exists must not be
    // re-saved as a route. The button is disabled until the roster loads, so
    // `projects` is non-null here in practice.
    const ids = (projects ?? []).filter((p) => selected.has(p.id)).map((p) => p.id);
    try {
      const saved = await api.setProjectRoutes(entry.id, ids);
      addToast(m.routing_saved, 'success');
      onSaved(saved.map((r) => r.projectId));
      onClose();
    } catch (err) {
      silentCatch('features/triggers/sub_shared/FeedRoutingPopover:save')(err);
      addToast(m.routing_save_failed, 'error');
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${m.routing_title} — ${entry.name}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <Route className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption text-foreground truncate">{m.routing_title} — {entry.name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="px-3 pt-2 typo-caption text-foreground/90 leading-snug">{m.routing_hint}</p>

      {loadFailed ? (
        <p className="px-3 py-4 typo-caption text-status-error text-center">{m.routing_load_failed}</p>
      ) : projects === null ? (
        <p className="px-3 py-4 typo-caption text-foreground/90 text-center">{m.routing_loading}</p>
      ) : projects.length === 0 ? (
        <p className="px-3 py-4 typo-caption text-foreground/90 text-center">{m.routing_empty}</p>
      ) : (
        <ul className="max-h-52 overflow-y-auto p-1.5">
          {projects.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/[0.04] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => setSelected((p) => {
                    const n = new Set(p);
                    if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                    return n;
                  })}
                  className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="typo-caption text-foreground truncate">{r.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-primary/10 bg-secondary/10">
        <AsyncButton size="xs" variant="primary" onClick={save} disabled={projects === null} loadingText={m.routing_saving}>
          {m.routing_save}
        </AsyncButton>
      </div>
    </div>,
    document.body,
  );
}
