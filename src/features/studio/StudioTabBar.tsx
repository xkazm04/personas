import { useState } from 'react';
import { Bot, ListChecks, Plus, X } from 'lucide-react';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useStudioStore } from './studioStore';
import { useStudioHistory } from './studioHistory';
import { phaseProgress } from './studioBuildModel';

// Browser-style tab strip. Each open project is a tab carrying its own live
// status dot (so you can see which projects are building while you're on
// another). The "+" opens a picker: existing projects to open, or a new build.
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

  const history = useStudioHistory((s) => s.byProject);
  // Re-openable projects, most-recently-worked first so historic work is easy to
  // resume from the toolbar.
  const openable = projects
    .filter((p) => !tabOrder.includes(p.id))
    .sort((a, b) => (history[b.id]?.updatedAt ?? 0) - (history[a.id]?.updatedAt ?? 0));

  return (
    <header className="relative flex w-full min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-border px-3 py-1.5">
      <Bot className="h-5 w-5 shrink-0 text-primary" />

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
              active
                ? 'border-primary bg-secondary/50'
                : 'border-transparent hover:bg-secondary/30'
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
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        aria-label="Open or create a project"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-interactive text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>

      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
          <div className="absolute left-3 top-full z-40 mt-1 w-56 overflow-hidden rounded-card border border-border bg-background/95 py-1 shadow-elevation-4 backdrop-blur">
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
            {openable.length > 0 && (
              <>
                <div className="my-1 h-px bg-border" />
                <div className="px-3 py-1 typo-caption text-foreground/45">Recent projects</div>
              </>
            )}
            <div className="max-h-60 overflow-y-auto">
              {openable.map((p) => {
                const h = history[p.id];
                const prog = h ? phaseProgress(h.phases) : null;
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
                    {prog && (
                      <span
                        className="flex shrink-0 items-center gap-1 typo-caption text-foreground/45"
                        title="Saved checklist progress — re-opens with its history"
                      >
                        <ListChecks className="h-3 w-3" />
                        {prog.done}/{prog.total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
