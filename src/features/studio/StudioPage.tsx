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
// building while you're on another tab or another app module.
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
  const [iframeNonce, setIframeNonce] = useState(0);
  const [previewRoute, setPreviewRoute] = useState('/');
  const [routes, setRoutes] = useState<string[]>([]);

  const initStream = useStudioStore((s) => s.initStream);
  const createWithVision = useStudioStore((s) => s.createWithVision);
  const activeId = useStudioStore((s) => s.activeId);
  const active = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const tabCount = useStudioStore((s) => s.tabOrder.length);

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

  // Reset the preview route when switching projects.
  useEffect(() => {
    setPreviewRoute('/');
  }, [activeId]);

  // Discover the active project's routes once it's live (and after a reload).
  useEffect(() => {
    if (activeId && active?.phase === 'live') {
      webbuildListRoutes(activeId)
        .then(setRoutes)
        .catch(() => setRoutes([]));
    } else {
      setRoutes([]);
    }
  }, [activeId, active?.phase, iframeNonce]);

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

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <StudioTabBar projects={projects} onNew={() => setCreating(true)} />

      <div className="relative min-h-0 w-full min-w-0 flex-1 bg-black/20">
        {showVision ? (
          <StudioVisionStart onSubmit={onCreate} busy={submitting} />
        ) : live && activeId && active.status ? (
          <>
            <iframe
              key={`${activeId}-${iframeNonce}`}
              src={`${active.status.url}${previewRoute === '/' ? '' : previewRoute}`}
              title="preview"
              className="absolute inset-0 h-full w-full border-0 bg-white"
            />
            <button
              type="button"
              onClick={() => setIframeNonce((n) => n + 1)}
              aria-label="Reload preview"
              className="absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-foreground/70 shadow-elevation-2 backdrop-blur hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            {/* Cross-page nav: click a route to jump the preview to it. */}
            {routes.filter((r) => !r.includes('[')).length > 1 && (
              <div className="absolute left-1/2 top-3 z-20 flex max-w-[60%] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-border bg-background/85 px-2 py-1 shadow-elevation-2 backdrop-blur">
                {routes
                  .filter((r) => !r.includes('['))
                  .map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPreviewRoute(r)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs transition-colors ${
                        previewRoute === r
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
          <div className="flex h-full items-center justify-center px-6">
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
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="typo-caption max-w-sm">{COPY.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
