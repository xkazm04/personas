import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { silentCatch } from '@/lib/silentCatch';
import { webbuildListRoutes } from '@/api/webbuild';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useStudioStore } from './studioStore';
import { previewTargetOrigin } from './studioBuildModel';

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function sameRect(a: PreviewRect | null, b: PreviewRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// The preview machinery both Studio layouts share: warm iframes per live tab,
// per-tab route + reload nonce, the address bar's live path, route discovery,
// and the precise orb pointer (A3). Moved out of StudioPage unchanged so the
// Guide layout renders the same previews instead of a second copy of them.
export function useStudioPreview() {
  const activeId = useStudioStore((s) => s.activeId);
  // Narrow subscriptions (perf): the CLI emits many stream deltas per second
  // during a build turn, each replacing the runtime object, so select only the
  // shallow-comparable fields the preview needs.
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

  // Per-tab UI state (keyed by project id) so each tab keeps its own route +
  // reload nonce — switching tabs never disturbs another tab's preview.
  const [iframeNonces, setIframeNonces] = useState<Record<string, number>>({});
  const [previewRoutes, setPreviewRoutes] = useState<Record<string, string>>({});
  // The live path each tab's preview reports as the user navigates inside it
  // (any client router, via the agent's History hook). Distinct from
  // previewRoutes, which is the path WE push the iframe to (a full load).
  const [currentPaths, setCurrentPaths] = useState<Record<string, string>>({});
  const [routesByTab, setRoutesByTab] = useState<Record<string, string[]>>({});
  // Precise orb-pointer rect (A3): the bounding box of the element a decision is
  // about, reported by the preview agent over postMessage.
  const [pointerRect, setPointerRect] = useState<PreviewRect | null>(null);
  // Stops the running locate ping; the agent's first answer ends the retries.
  const stopLocateRef = useRef<(() => void) | null>(null);

  const activeNonce = activeId ? (iframeNonces[activeId] ?? 0) : 0;
  // The window `message` listener is registered once, so it reads the active
  // tab through a ref rather than closing over a stale `activeId`.
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  // Discover the active tab's routes once it's live (and after a reload).
  useEffect(() => {
    if (activeId && active?.phase === 'live') {
      const id = activeId;
      webbuildListRoutes(id)
        .then((r) => setRoutesByTab((m) => ({ ...m, [id]: r })))
        .catch((err) => {
          silentCatch('useStudioPreview:listRoutes')(err);
          setRoutesByTab((m) => ({ ...m, [id]: [] }));
        });
    }
  }, [activeId, active?.phase, activeNonce]);

  // A3 precise pointer — receive the preview agent's rect replies.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { source?: string; type?: string; found?: boolean; path?: string; rect?: PreviewRect | null }
        | null;
      if (!d || d.source !== 'athena-agent') return;
      // `source: 'athena-agent'` is a claim, not proof: window `message` fires
      // for EVERY frame on the page, including anything the previewed site
      // itself embeds. Attribute every report to a real preview frame by
      // identity (contentWindow) before acting on it.
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-tab]')).find(
        (f) => f.contentWindow === e.source,
      );
      const id = frame?.dataset.tab;
      if (!id) return;
      if (d.type === 'located') {
        // Only the tab the user is looking at may move the orb.
        if (id !== activeIdRef.current) return;
        const next = d.found && d.rect ? d.rect : null;
        if (next) stopLocateRef.current?.();
        // The same rect again keeps the same object: no re-render, no new orb flight.
        setPointerRect((prev) => (sameRect(prev, next) ? prev : next));
      } else if (d.type === 'route' && typeof d.path === 'string') {
        const path = d.path;
        setCurrentPaths((m) => (m[id] === path ? m : { ...m, [id]: path }));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // When a decision targets a specific element, ask the preview agent to locate
  // it. Retry a few times: the preview may have just hot-reloaded from the build
  // turn, so the agent's listener might not be ready on the first ping.
  useEffect(() => {
    setPointerRect(null);
    if (!active?.question || !active?.decisionSelector) return;
    // The dev server's own origin, so the ping is addressed rather than
    // broadcast. No origin means we send NOTHING; '*' would restore the very
    // behaviour the named origin exists to remove.
    const targetOrigin = previewTargetOrigin(activeId ? previewUrls[activeId] : null);
    if (!targetOrigin) return;
    const selector = active.decisionSelector;
    let tries = 0;
    const stop = () => window.clearInterval(interval);
    stopLocateRef.current = stop;
    const interval = window.setInterval(() => {
      // Address the frame by its tab id, never by the `title` attribute (display copy).
      const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-tab="${CSS.escape(activeId ?? '')}"]`);
      iframe?.contentWindow?.postMessage({ source: 'athena', type: 'locate', selector, reqId: `${activeId}` }, targetOrigin);
      if (++tries >= 8) stop();
    }, 700);
    return () => {
      stop();
      if (stopLocateRef.current === stop) stopLocateRef.current = null;
    };
  }, [activeId, active?.question, active?.decisionSelector, previewUrls]);

  // Fly Athena's global orb to the element a precise decision is about. The
  // element's rect is in the iframe's viewport; add the iframe's screen offset.
  useEffect(() => {
    const setTarget = useCompanionStore.getState().setOrbGuideTarget;
    if (active?.question && pointerRect) {
      const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-tab="${CSS.escape(activeId ?? '')}"]`);
      const ir = iframe?.getBoundingClientRect();
      if (ir) setTarget({ left: ir.left + pointerRect.x + pointerRect.width, top: ir.top + pointerRect.y });
    } else {
      setTarget(null);
    }
    return () => useCompanionStore.getState().setOrbGuideTarget(null);
  }, [activeId, active?.question, pointerRect]);

  const reloadActive = useCallback(() => {
    if (activeId) setIframeNonces((m) => ({ ...m, [activeId]: (m[activeId] ?? 0) + 1 }));
  }, [activeId]);

  // Show what the preview reports (updates live as the user clicks links inside
  // it), falling back to the path we last pushed.
  const activePath = (activeId && (currentPaths[activeId] ?? previewRoutes[activeId])) || '/';
  // A full load to any path: framework-agnostic (Next app/pages, React Router).
  const navigateTo = useCallback(
    (raw: string) => {
      if (!activeId) return;
      const p = raw.trim() ? (raw.startsWith('/') ? raw : `/${raw}`) : '/';
      setPreviewRoutes((m) => ({ ...m, [activeId]: p }));
      setCurrentPaths((m) => ({ ...m, [activeId]: p }));
    },
    [activeId],
  );
  const navRoutes = ((activeId && routesByTab[activeId]) || []).filter((r) => !r.includes('['));
  const live = !!active && active.phase === 'live' && active.healthy;

  return {
    activeId,
    active,
    live,
    previewUrls,
    previewRoutes,
    iframeNonces,
    pointerRect,
    activePath,
    navRoutes,
    navigateTo,
    reloadActive,
  };
}

export type StudioPreviewState = ReturnType<typeof useStudioPreview>;
