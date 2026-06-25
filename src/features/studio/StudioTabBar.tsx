import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderGit2, FolderInput, ListChecks, Plus, X } from 'lucide-react';
import type { DevProject } from '@/lib/bindings/DevProject';
import { webbuildNextReady } from '@/api/webbuild';
import { useStudioStore } from './studioStore';
import { useStudioHistory } from './studioHistory';
import { phaseProgress } from './studioBuildModel';

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const tabOrder = useStudioStore((s) => s.tabOrder);
  const runtimes = useStudioStore((s) => s.runtimes);
  const activeId = useStudioStore((s) => s.activeId);
  const setActive = useStudioStore((s) => s.setActive);
  const closeTab = useStudioStore((s) => s.closeTab);
  const startExisting = useStudioStore((s) => s.startExisting);
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
      .catch(() => {});
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
      title: 'Add an existing Next.js project',
    });
    if (typeof path === 'string') void importExisting(path);
  };

  // The picker is portalled to <body> + fixed-positioned under the "+" button, so
  // it escapes the tab strip's `overflow-x` clip (which would otherwise hide it).
  const plusRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const togglePicker = () => {
    if (!pickerOpen) {
      const r = plusRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setPickerOpen((o) => !o);
  };

  return (
    <header className="relative flex w-full min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-border px-3 py-1.5">
      {tabOrder.map((id) => {
        const rt = runtimes[id];
        if (!rt) return null;
        const active = activeId === id;
        const dot =
          rt.autonomous || rt.busy
            ? 'bg-primary animate-pulse'
            : rt.phase === 'live'
              ? 'bg-status-success'
              : rt.phase === 'error'
                ? 'bg-status-error'
                : 'bg-foreground/30';
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
              className={`flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-md ${
                active ? 'text-foreground' : 'text-foreground/60 group-hover:text-foreground'
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span className="max-w-[10rem] truncate">{rt.name}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(id)}
              aria-label={`Close ${rt.name}`}
              className="mr-1 shrink-0 rounded-interactive p-0.5 text-foreground/40 opacity-0 hover:text-foreground group-hover:opacity-100"
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
        aria-label="Open or create a project"
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
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  onNew();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-md text-foreground hover:bg-secondary/50"
              >
                <Plus className="h-3.5 w-3.5 text-primary" /> New project
              </button>
              <button
                type="button"
                onClick={() => void addExisting()}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-md text-foreground hover:bg-secondary/50"
              >
                <FolderInput className="h-3.5 w-3.5 text-primary" /> Add existing project…
              </button>
              {(recent.length > 0 || importable.length > 0) && (
                <div className="max-h-72 overflow-y-auto">
                  {recent.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <div className="px-3 py-1 typo-caption text-foreground/45">Resume</div>
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
                              title="Saved checklist progress — re-opens with its history"
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
                        Dev Tools projects
                      </div>
                      {importable.map((p) => {
                        const blocked = nextReady[p.id] === false;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={blocked}
                            onClick={() => {
                              if (blocked) return;
                              setPickerOpen(false);
                              void startExisting(p.id, p.name);
                            }}
                            title={
                              blocked
                                ? 'Not a Next.js app — Studio builds Next.js + Tailwind projects'
                                : p.root_path
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
                                Not Next.js
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
