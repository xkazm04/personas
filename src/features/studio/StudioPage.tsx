import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, RotateCcw } from 'lucide-react';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { webbuildListProjects, webbuildListRoutes } from '@/api/webbuild';
import type { DevProject } from '@/lib/bindings/DevProject';
import StudioTabBar from './StudioTabBar';
import StudioChatInput from './StudioChatInput';
import StudioVisionStart from './StudioVisionStart';
import StudioVersions from './StudioVersions';
import { useStudioStore } from './studioStore';
import { useStudioHistory } from './studioHistory';
import { previewTargetOrigin } from './studioBuildModel';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';

// Dev-only experimental surface — Athena web-dev companion. Projects run as
// browser-style tabs; all build runtime lives in studioStore so a project keeps
// building while you're on another tab or another app module. Previews are kept
// "warm" (every live tab mounted, only the active visible) so switching tabs is
// instant + lossless instead of reloading the dev server each time (B1).
export default function StudioPage() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Per-tab UI state (keyed by project id) so each tab keeps its own route +
  // reload nonce — switching tabs never disturbs another tab's preview.
  const [iframeNonces, setIframeNonces] = useState<Record<string, number>>({});
  const [previewRoutes, setPreviewRoutes] = useState<Record<string, string>>({});
  // The live path each tab's preview reports as the user navigates inside it (any
  // client router, via the agent's History hook) — drives the address bar. Distinct
  // from previewRoutes, which is the path WE push the iframe to (a full load).
  const [currentPaths, setCurrentPaths] = useState<Record<string, string>>({});
  const [urlDraft, setUrlDraft] = useState('/');
  const urlEditing = useRef(false);
  const [routesByTab, setRoutesByTab] = useState<Record<string, string[]>>({});
  // Precise orb-pointer rect (A3) — the bounding box of the element a decision is
  // about, reported by the preview agent over postMessage.
  const [pointerRect, setPointerRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const initStream = useStudioStore((s) => s.initStream);
  const createWithVision = useStudioStore((s) => s.createWithVision);
  const activeId = useStudioStore((s) => s.activeId);
  const tabCount = useStudioStore((s) => s.tabOrder.length);
  const lastCreateError = useStudioStore((s) => s.lastCreateError);
  const startExisting = useStudioStore((s) => s.startExisting);
  // Narrow subscriptions (perf) — StudioPage never reads `stream`, but the CLI
  // emits many stream deltas per second during a build turn, each replacing the
  // runtime object. Subscribing to the whole `runtimes` map re-rendered this
  // entire tree (tab strip, warm iframes, toolbar, dock) per delta, so select
  // only the shallow-comparable fields the page actually renders.
  const active = useStudioStore(
    useShallow((s) => {
      const rt = s.activeId ? s.runtimes[s.activeId] : undefined;
      if (!rt) return undefined;
      return {
        name: rt.name,
        phase: rt.phase,
        healthy: !!rt.status?.healthy,
        question: rt.question,
        decisionArea: rt.decisionArea,
        decisionSelector: rt.decisionSelector,
      };
    }),
  );
  // Warm previews: id → dev-server URL for every live+healthy tab, in tab order.
  // String values keep the useShallow compare stable across stream deltas.
  const previewUrls = useStudioStore(
    useShallow((s) => {
      const out: Record<string, string> = {};
      for (const id of s.tabOrder) {
        const rt = s.runtimes[id];
        if (rt && rt.phase === 'live' && rt.status?.healthy) out[id] = rt.status.url;
      }
      return out;
    }),
  );
  const activeNonce = activeId ? (iframeNonces[activeId] ?? 0) : 0;
  // The window `message` listener is registered once (it must not be torn down
  // and re-attached on every tab switch), so it reads the active tab through a
  // ref rather than closing over a stale `activeId`.
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const refreshProjects = useCallback(async () => {
    try {
      const list = await webbuildListProjects();
      setProjects(list);
      // The one place in Studio holding the authoritative project list, so the
      // one place that can reap persisted history for projects that are gone.
      // Without it `byProject` and `openTabIds` only ever grew: a deleted
      // project kept its saved log forever, and its stale tab id was re-walked
      // by `rehydrate` on every launch. A prune with nothing stale is a no-op.
      useStudioHistory.getState().prune(list.map((p) => p.id));
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
        .catch((err) => {
          silentCatch('StudioPage:listRoutes')(err);
          setRoutesByTab((m) => ({ ...m, [id]: [] }));
        });
    }
  }, [activeId, active?.phase, activeNonce]);

  // A3 precise pointer — receive the preview agent's rect replies.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | {
            source?: string;
            type?: string;
            found?: boolean;
            path?: string;
            rect?: { x: number; y: number; width: number; height: number } | null;
          }
        | null;
      if (!d || d.source !== 'athena-agent') return;
      // `source: 'athena-agent'` is a claim, not proof — window `message` fires
      // for EVERY frame on the page, including anything the previewed site
      // itself embeds. So attribute every report to a real preview frame by
      // identity (contentWindow) before acting on it. The route branch already
      // did this to know which tab reported; `located` did not, and would move
      // the orb to a rect handed over by any nested frame.
      const frame = Array.from(
        document.querySelectorAll<HTMLIFrameElement>('iframe[data-tab]'),
      ).find((f) => f.contentWindow === e.source);
      const id = frame?.dataset.tab;
      if (!id) return;
      if (d.type === 'located') {
        // Only the tab the user is looking at may move the orb.
        if (id !== activeIdRef.current) return;
        setPointerRect(d.found && d.rect ? d.rect : null);
      } else if (d.type === 'route' && typeof d.path === 'string') {
        const path = d.path;
        setCurrentPaths((m) => (m[id] === path ? m : { ...m, [id]: path }));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // When a decision targets a specific element, ask the preview agent to locate it.
  // Retry a few times: the preview may have just hot-reloaded from the build turn,
  // so the agent's message listener might not be ready on the first ping. Each
  // reply (handled above) sets pointerRect; extra pings after that are harmless.
  useEffect(() => {
    setPointerRect(null);
    if (!active?.question || !active?.decisionSelector) return;
    // The dev server's own origin, so the ping is addressed rather than
    // broadcast. No origin (no URL yet, or it won't parse) means we send
    // NOTHING — falling back to '*' would restore the very behaviour the named
    // origin exists to remove, and the preview is a user-authored dev site that
    // can navigate itself somewhere else at any moment.
    const targetOrigin = previewTargetOrigin(activeId ? previewUrls[activeId] : null);
    if (!targetOrigin) return;
    const selector = active.decisionSelector;
    let tries = 0;
    const interval = window.setInterval(() => {
      // Address the frame by its tab id, never by the `title` attribute: the
      // title is display copy (and unlocalized copy at that), so a translation
      // or a wording tweak would silently break the orb pointer.
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-tab="${CSS.escape(activeId ?? '')}"]`,
      );
      iframe?.contentWindow?.postMessage(
        { source: 'athena', type: 'locate', selector, reqId: `${activeId}` },
        targetOrigin,
      );
      if (++tries >= 8) window.clearInterval(interval);
    }, 700);
    return () => window.clearInterval(interval);
  }, [activeId, active?.question, active?.decisionSelector, previewUrls]);

  // Fly Athena's global orb to the element a precise decision is about — reusing
  // the companion walkthrough's orb-target glide. The element's rect is in the
  // iframe's viewport; add the iframe's screen offset to get a screen position.
  // Returns the orb to its dock when the decision clears or Studio unmounts.
  useEffect(() => {
    const setTarget = useCompanionStore.getState().setOrbGuideTarget;
    if (active?.question && pointerRect) {
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-tab="${CSS.escape(activeId ?? '')}"]`,
      );
      const ir = iframe?.getBoundingClientRect();
      if (ir) {
        setTarget({ left: ir.left + pointerRect.x + pointerRect.width, top: ir.top + pointerRect.y });
      }
    } else {
      setTarget(null);
    }
    return () => useCompanionStore.getState().setOrbGuideTarget(null);
  }, [activeId, active?.question, pointerRect]);

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
  const live = !!active && active.phase === 'live' && active.healthy;
  const liveTabs = Object.keys(previewUrls);
  const navRoutes = ((activeId && routesByTab[activeId]) || []).filter((r) => !r.includes('['));
  const reloadActive = () =>
    activeId && setIframeNonces((m) => ({ ...m, [activeId]: (m[activeId] ?? 0) + 1 }));
  // Address bar: show what the preview reports (updates live as the user clicks
  // links inside it), falling back to the path we last pushed. navigateTo does a
  // full load to any path — framework-agnostic (Next app/pages, React Router).
  const activePath = (activeId && (currentPaths[activeId] ?? previewRoutes[activeId])) || '/';
  const navigateTo = (raw: string) => {
    if (!activeId) return;
    const p = raw.trim() ? (raw.startsWith('/') ? raw : `/${raw}`) : '/';
    setPreviewRoutes((m) => ({ ...m, [activeId]: p }));
    setCurrentPaths((m) => ({ ...m, [activeId]: p }));
  };

  // Keep the address-bar draft synced to the live path, unless the user is editing.
  useEffect(() => {
    if (!urlEditing.current) setUrlDraft(activePath);
  }, [activePath]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <StudioTabBar projects={projects} onNew={() => setCreating(true)} />

      <div className="relative min-h-0 w-full min-w-0 flex-1 bg-black/20">
        {showVision ? (
          <StudioVisionStart onSubmit={onCreate} busy={submitting} error={lastCreateError} />
        ) : (
          <>
            {/* Warm previews — every live tab stays mounted; only active is shown. */}
            {liveTabs.map((id) => {
              const route = previewRoutes[id] ?? '/';
              const nonce = iframeNonces[id] ?? 0;
              const isActive = id === activeId;
              return (
                <iframe
                  key={`${id}-${nonce}`}
                  data-tab={id}
                  src={`${previewUrls[id]}${route === '/' ? '' : route}`}
                  title={isActive ? 'preview' : `preview-${id}`}
                  aria-hidden={!isActive}
                  // `opacity-0` + `pointer-events-none` hides a warm preview
                  // from the mouse and from sight, and from neither the Tab key
                  // nor the accessibility tree's focus order: an iframe stays
                  // focusable, and so does every control inside its document.
                  // Tabbing out of the dock therefore walked into an invisible
                  // copy of another project's site — and `aria-hidden` over
                  // focusable content is itself the ARIA violation. `inert`
                  // (Chromium 102+, so every WebView2 this ships on) is the one
                  // attribute that removes a subtree from focus AND from the
                  // a11y tree; `tabIndex={-1}` alone would not reach inside.
                  {...(isActive ? {} : { inert: true, tabIndex: -1 })}
                  className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-200 ${
                    isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                />
              );
            })}

            {active && live && activeId ? (
              <>
                {/* Unified preview toolbar — reload · routes · versions in one bar
                    instead of three overlays scattered around the preview edges. */}
                <div className="absolute left-1/2 top-3 z-20 flex w-[min(34rem,82%)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background/85 px-1.5 py-1 shadow-elevation-2 backdrop-blur">
                  <button
                    type="button"
                    onClick={reloadActive}
                    aria-label={t.studio.reload_preview}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/65 transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                  {/* Address bar — type any path + Enter to load it (works for
                      Next app/pages + React Router), and it live-syncs to where the
                      preview navigates. Discovered app-router routes autocomplete. */}
                  <div className="flex min-w-0 flex-1 items-center">
                    <input
                      data-testid="studio-preview-url"
                      value={urlDraft}
                      list={navRoutes.length ? 'studio-routes' : undefined}
                      onFocus={() => {
                        urlEditing.current = true;
                      }}
                      onBlur={() => {
                        urlEditing.current = false;
                        setUrlDraft(activePath);
                      }}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          navigateTo(urlDraft);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      spellCheck={false}
                      aria-label={t.studio.preview_path}
                      placeholder="/"
                      className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground/85 outline-none placeholder:text-foreground/40"
                    />
                    {navRoutes.length > 0 && (
                      <datalist id="studio-routes">
                        {navRoutes.map((r) => (
                          <option key={r} value={r} />
                        ))}
                      </datalist>
                    )}
                  </div>
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                  <StudioVersions id={activeId} onRestored={reloadActive} />
                </div>
                {/* A3 — orb pointer: precise ring around the element when the preview
                    agent returned a rect, else the coarse top/middle/bottom region. */}
                {active.question && pointerRect ? (
                  <div
                    data-testid="studio-orb-pointer"
                    className="pointer-events-none absolute z-20 rounded-lg ring-2 ring-primary transition-all duration-300"
                    style={{
                      left: pointerRect.x,
                      top: pointerRect.y,
                      width: pointerRect.width,
                      height: pointerRect.height,
                    }}
                  >
                    <span className="absolute -right-2.5 -top-2.5 flex h-7 w-7 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
                      <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/25 ring-2 ring-primary backdrop-blur">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </span>
                    </span>
                  </div>
                ) : active.question && active.decisionArea ? (
                  <div
                    className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 ${
                      active.decisionArea === 'top'
                        ? 'top-16'
                        : active.decisionArea === 'bottom'
                          ? 'bottom-32'
                          : 'top-1/2 -translate-y-1/2'
                    }`}
                  >
                    <span className="relative flex h-9 w-9 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
                      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/25 ring-2 ring-primary backdrop-blur">
                        <Bot className="h-4 w-4 text-primary" />
                      </span>
                    </span>
                  </div>
                ) : null}
                <StudioChatInput />
              </>
            ) : active ? (
              <div className="absolute inset-0 flex items-center justify-center px-6">
                <div className="flex items-center gap-3 rounded-card border border-border bg-background/80 px-5 py-4 shadow-elevation-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <span className="text-md text-foreground/80">
                    {active.phase === 'scaffolding'
                      ? t.studio.scaffolding
                      : active.phase === 'starting'
                        ? t.studio.starting
                        : active.phase === 'error'
                          ? t.studio.start_error
                          : active.name}
                  </span>
                  {/* A boot that gave up now says so, and a dead end needs a way
                      out of it — the previous error state was copy with nothing
                      to do about it. `startExisting` is idempotent for a project
                      already open, so it is a plain cold restart. */}
                  {active.phase === 'error' && activeId && (
                    <AsyncButton
                      size="sm"
                      variant="secondary"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      onClick={() => startExisting(activeId, active.name)}
                    >
                      {t.common.retry}
                    </AsyncButton>
                  )}
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <p className="typo-caption max-w-sm">{t.studio.no_project_open}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
