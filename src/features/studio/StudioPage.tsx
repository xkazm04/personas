import { useCallback, useEffect, useState } from 'react';
import { Bot, RotateCcw } from 'lucide-react';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildListProjects, webbuildListRoutes } from '@/api/webbuild';
import type { DevProject } from '@/lib/bindings/DevProject';
import StudioTabBar from './StudioTabBar';
import StudioChecklist from './StudioChecklist';
import StudioChatInput from './StudioChatInput';
import StudioVisionStart from './StudioVisionStart';
import { useStudioStore } from './studioStore';

// Dev-only experimental surface — Athena web-dev companion. Projects run as
// browser-style tabs; all build runtime lives in studioStore so a project keeps
// building while you're on another tab or another app module. Previews are kept
// "warm" (every live tab mounted, only the active visible) so switching tabs is
// instant + lossless instead of reloading the dev server each time (B1).
const COPY = {
  scaffolding: 'Scaffolding with Bun — this can take a minute…',
  starting: 'Starting the dev server…',
  error: 'Something went wrong starting this project.',
  empty: 'No project open — use + to open an existing project or start a new one.',
};

export default function StudioPage() {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Per-tab UI state (keyed by project id) so each tab keeps its own route +
  // reload nonce — switching tabs never disturbs another tab's preview.
  const [iframeNonces, setIframeNonces] = useState<Record<string, number>>({});
  const [previewRoutes, setPreviewRoutes] = useState<Record<string, string>>({});
  const [routesByTab, setRoutesByTab] = useState<Record<string, string[]>>({});

  const initStream = useStudioStore((s) => s.initStream);
  const createWithVision = useStudioStore((s) => s.createWithVision);
  const activeId = useStudioStore((s) => s.activeId);
  const runtimes = useStudioStore((s) => s.runtimes);
  const tabOrder = useStudioStore((s) => s.tabOrder);

  const active = activeId ? runtimes[activeId] : undefined;
  const tabCount = tabOrder.length;
  const activeNonce = activeId ? (iframeNonces[activeId] ?? 0) : 0;

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await webbuildListProjects());
    } catch (e) {
      toastCatch('load projects')(e);
    }
  }, []);

  useEffect(() => {
    initStream();
    void refreshProjects();
  }, [initStream, refreshProjects]);

  // Discover the active tab's routes once it's live (and after a reload).
  useEffect(() => {
    if (activeId && active?.phase === 'live') {
      const id = activeId;
      webbuildListRoutes(id)
        .then((r) => setRoutesByTab((m) => ({ ...m, [id]: r })))
        .catch(() => setRoutesByTab((m) => ({ ...m, [id]: [] })));
    }
  }, [activeId, active?.phase, activeNonce]);

  const onCreate = useCallback(
    async (name: string, vision: string) => {
      setSubmitting(true);
      try {
        await createWithVision(name, vision);
        await refreshProjects();
        setCreating(false);
      } finally {
        setSubmitting(false);
      }
    },
    [createWithVision, refreshProjects],
  );

  const showVision = creating || tabCount === 0;
  const live = !!active && active.phase === 'live' && !!active.status?.healthy;
  const liveTabs = tabOrder.filter((id) => {
    const rt = runtimes[id];
    return !!rt && rt.phase === 'live' && !!rt.status?.healthy;
  });
  const activeRoute = (activeId && previewRoutes[activeId]) || '/';
  const navRoutes = ((activeId && routesByTab[activeId]) || []).filter((r) => !r.includes('['));
  const reloadActive = () =>
    activeId && setIframeNonces((m) => ({ ...m, [activeId]: (m[activeId] ?? 0) + 1 }));
  const goToRoute = (r: string) =>
    activeId && setPreviewRoutes((m) => ({ ...m, [activeId]: r }));

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <StudioTabBar projects={projects} onNew={() => setCreating(true)} />

      <div className="relative min-h-0 w-full min-w-0 flex-1 bg-black/20">
        {showVision ? (
          <StudioVisionStart onSubmit={onCreate} busy={submitting} />
        ) : (
          <>
            {/* Warm previews — every live tab stays mounted; only active is shown. */}
            {liveTabs.map((id) => {
              const rt = runtimes[id];
              if (!rt || !rt.status) return null;
              const route = previewRoutes[id] ?? '/';
              const nonce = iframeNonces[id] ?? 0;
              const isActive = id === activeId;
              return (
                <iframe
                  key={`${id}-${nonce}`}
                  src={`${rt.status.url}${route === '/' ? '' : route}`}
                  title={isActive ? 'preview' : `preview-${id}`}
                  aria-hidden={!isActive}
                  className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-200 ${
                    isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                />
              );
            })}

            {live && activeId && active?.status ? (
              <>
                <button
                  type="button"
                  onClick={reloadActive}
                  aria-label="Reload preview"
                  className="absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-foreground/70 shadow-elevation-2 backdrop-blur hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                {/* Cross-page nav: click a route to jump the active preview to it. */}
                {navRoutes.length > 1 && (
                  <div className="absolute left-1/2 top-3 z-20 flex max-w-[60%] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-border bg-background/85 px-2 py-1 shadow-elevation-2 backdrop-blur">
                    {navRoutes.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => goToRoute(r)}
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs transition-colors ${
                          activeRoute === r
                            ? 'bg-primary/20 text-primary'
                            : 'text-foreground/60 hover:text-foreground'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
                <StudioChecklist phases={active.phases} />
                <StudioChatInput />
              </>
            ) : active ? (
              <div className="absolute inset-0 flex items-center justify-center px-6">
                <div className="flex items-center gap-3 rounded-card border border-border bg-background/80 px-5 py-4 shadow-elevation-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <span className="text-md text-foreground/80">
                    {active.phase === 'scaffolding'
                      ? COPY.scaffolding
                      : active.phase === 'starting'
                        ? COPY.starting
                        : active.phase === 'error'
                          ? COPY.error
                          : active.name}
                  </span>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <p className="typo-caption max-w-sm">{COPY.empty}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
