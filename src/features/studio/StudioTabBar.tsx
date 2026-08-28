import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderGit2, FolderInput, ListChecks, Plus, X } from 'lucide-react';
import type { DevProject } from '@/lib/bindings/DevProject';
import { webbuildNextReady } from '@/api/webbuild';
import { useTranslation } from '@/i18n/useTranslation';
import { useStudioStore } from './studioStore';
import { useStudioHistory } from './studioHistory';
import { phaseProgress, tabDotClass } from './studioBuildModel';
import { silentCatch } from '@/lib/silentCatch';

// Browser-style tab strip. Each open project is a tab carrying its own live
// status dot (so you can see which projects are building while you're on
// another). The "+" opens a picker: new build, import an existing project, or
// re-open a previous one.
export default function StudioTabBar({
  projects,
  onNew,
}: {
  projects: DevProject[];
  onNew: () => void;
}) {
  const { t, tx } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const tabOrder = useStudioStore((s) => s.tabOrder);
  // Perf: the strip only needs each tab's name + status-dot class. Selecting the
  // whole `runtimes` map re-rendered the strip on every CLI stream delta (each
  // delta replaces a runtime object); string-valued records keep the shallow
  // compare stable until a name/phase/busy state actually changes.
  const tabNames = useStudioStore(
    useShallow((s) => {
      const out: Record<string, string> = {};
      for (const id of s.tabOrder) {
        const rt = s.runtimes[id];
        if (rt) out[id] = rt.name;
      }
      return out;
    }),
  );
  const tabDots = useStudioStore(
    useShallow((s) => {
      const out: Record<string, string> = {};
      for (const id of s.tabOrder) {
        const rt = s.runtimes[id];
        if (!rt) continue;
        out[id] = tabDotClass(rt);
      }
      return out;
    }),
  );
  const activeId = useStudioStore((s) => s.activeId);
  const setActive = useStudioStore((s) => s.setActive);
  const closeTab = useStudioStore((s) => s.closeTab);
  const startExisting = useStudioStore((s) => s.startExisting);
  const openImportable = useStudioStore((s) => s.openImportable);
  const importExisting = useStudioStore((s) => s.importExisting);

  const history = useStudioHistory((s) => s.byProject);
  // Re-openable projects, most-recently-worked first so historic work is easy to
  // resume from the toolbar.
  const openable = projects
    .filter((p) => !tabOrder.includes(p.id))
    .sort((a, b) => (history[b.id]?.updatedAt ?? 0) - (history[a.id]?.updatedAt ?? 0));
  // Projects worked on in Studio before (resume w/ checklist + log) vs. existing
  // Personas Dev Tools projects you can import as a fresh Studio tab.
  const recent = openable.filter((p) => history[p.id]);
  const importable = openable.filter((p) => !history[p.id]);

  // Flag Dev Tools projects that aren't Next.js apps (Studio's preview runs
  // `next dev`) — checked on disk when the picker opens. undefined = unknown.
  const [nextReady, setNextReady] = useState<Record<string, boolean>>({});
  const importableKey = importable.map((p) => p.id).join(',');
  useEffect(() => {
    if (!pickerOpen || !importableKey) return;
    const ids = importableKey.split(',');
    let cancelled = false;
    void webbuildNextReady(ids)
      .then((readyIds) => {
        if (cancelled) return;
        const set = new Set(readyIds);
        setNextReady(Object.fromEntries(ids.map((id) => [id, set.has(id)])));
      })
      .catch(silentCatch('StudioTabBar:checkNextReady'));
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, importableKey]);

  // Browse to an existing Next.js project folder, register it, open it as a tab.
  const addExisting = async () => {
    setPickerOpen(false);
    const path = await open({
      directory: true,
      multiple: false,
      title: t.studio.add_existing_dialog_title,
    });
    if (typeof path === 'string') void importExisting(path);
  };

  // The picker is portalled to <body> + fixed-positioned under the "+" button, so
  // it escapes the tab strip's `overflow-x` clip (which would otherwise hide it).
  const plusRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const togglePicker = () => {
    if (!pickerOpen) {
      const r = plusRef.current?.getBoundingClientRect();
      if (r) {
        // Open to the RIGHT of the + button (left edge aligned with it), clamped
        // so the 16rem-wide menu never runs off either edge of the window.
        const width = 256;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        setMenuPos({ top: r.bottom + 4, left });
      }
    }
    setPickerOpen((o) => !o);
  };

  return (
    <header className="relative flex w-full min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-border px-3 py-1.5">
      {tabOrder.map((id) => {
        const name = tabNames[id];
        const dot = tabDots[id];
        if (name === undefined || dot === undefined) return null;
        const active = activeId === id;
        return (
          <div
            key={id}
            data-testid="studio-tab"
            className={`group flex shrink-0 items-center rounded-t-card border-b-2 transition-colors ${
              active ? 'border-primary bg-secondary/50' : 'border-transparent hover:bg-secondary/30'
            }`}
          >
            <button
              type="button"
              onClick={() => setActive(id)}
              // Which tab is active was carried by colour alone — a distinction
              // no screen-reader user and no high-contrast setting can see.
              aria-current={active ? 'true' : undefined}
              className={`flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-md ${
                active ? 'text-foreground' : 'text-foreground/60 group-hover:text-foreground'
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span className="max-w-[10rem] truncate">{name}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(id)}
              aria-label={tx(t.studio.close_tab, { name })}
              // `opacity-0` + `group-hover:opacity-100` alone makes this a
              // control you can Tab to but cannot see — the focus ring lands on
              // a fully transparent button. Reveal it on focus too.
              className="mr-1 shrink-0 rounded-interactive p-0.5 text-foreground/40 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <button
        ref={plusRef}
        type="button"
        onClick={togglePicker}
        aria-label={t.studio.open_or_create}
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-interactive text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>

      {pickerOpen &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[120]" onClick={() => setPickerOpen(false)} />
            <div
              className="fixed z-[121] w-64 overflow-hidden rounded-card border border-border bg-background/95 py-1 shadow-elevation-4 backdrop-blur"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  onNew();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-md text-foreground hover:bg-secondary/50"
              >
                <Plus className="h-3.5 w-3.5 text-primary" /> {t.studio.new_project}
              </button>
              <button
                type="button"
                onClick={() => void addExisting()}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-md text-foreground hover:bg-secondary/50"
              >
                <FolderInput className="h-3.5 w-3.5 text-primary" /> {t.studio.add_existing_project}
              </button>
              {(recent.length > 0 || importable.length > 0) && (
                <div className="max-h-72 overflow-y-auto">
                  {recent.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <div className="px-3 py-1 typo-caption text-foreground/45">
                        {t.studio.resume}
                      </div>
                      {recent.map((p) => {
                        const prog = phaseProgress(history[p.id]?.phases ?? []);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setPickerOpen(false);
                              void startExisting(p.id, p.name);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-md text-foreground/80 hover:bg-secondary/50 hover:text-foreground"
                          >
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span
                              className="flex shrink-0 items-center gap-1 typo-caption text-foreground/45"
                              title={t.studio.saved_progress_hint}
                            >
                              <ListChecks className="h-3 w-3" />
                              {prog.done}/{prog.total}
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}
                  {importable.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <div className="px-3 py-1 typo-caption text-foreground/45">
                        {t.studio.dev_tools_projects}
                      </div>
                      {importable.map((p) => {
                        const blocked = nextReady[p.id] === false;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={blocked}
                            // `blocked` is the ADVISORY hint from the probe
                            // above, and the probe can fail — in which case
                            // every row here reads as openable. The authority is
                            // the store's own guard, which re-checks and refuses
                            // with an explanation exactly like the browse path.
                            onClick={() => {
                              if (blocked) return;
                              setPickerOpen(false);
                              void openImportable(p.id, p.name);
                            }}
                            title={
                              blocked ? t.studio.not_next_js_hint : p.root_path
                            }
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-md ${
                              blocked
                                ? 'cursor-not-allowed text-foreground/35'
                                : 'text-foreground/80 hover:bg-secondary/50 hover:text-foreground'
                            }`}
                          >
                            <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            {blocked && (
                              <span className="shrink-0 typo-caption text-status-warning/80">
                                {t.studio.not_next_js}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </>,
          document.body,
        )}
    </header>
  );
}
