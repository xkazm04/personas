import { Component, lazy, Profiler, Suspense, useCallback, useEffect, useRef, useState, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/feedback/UpdateBanner";
import { ToastContainer } from "@/features/shared/components/feedback/ToastContainer";
import { LiveChannelOverlay } from "@/features/shared/components/layout/monitor/live/LiveChannelOverlay";
import RemoteApprovalPrompt from "@/features/cloud/RemoteApprovalPrompt";
import { FirstUseConsentModal, hasUserConsented, storedConsentVersion } from "@/features/shared/components/overlays/FirstUseConsentModal";
import { useAuthStore } from "@/stores/authStore";
import VibeThemeProvider from "@/features/shared/components/layout/VibeThemeProvider";
import { AriaLiveProvider } from "@/features/shared/components/feedback/AriaLiveProvider";
import { ChartGradientDefs } from "@/features/overview/sub_usage/components/ChartGradientDefs";
import { ResourcePickerHost } from "@/features/vault/sub_credentials/components/picker/ResourcePickerHost";
import { toggleMobilePreview } from "@/lib/utils/platform/platform";
import { useMobilePreview } from "@/hooks/utility/interaction/useMobilePreview";
import TitleBar from "@/features/shared/components/layout/TitleBar";
import FleetActivityStrip from "@/features/shared/components/layout/FleetActivityStrip";
import { useTranslation } from '@/i18n/useTranslation';
import { initPseudoLocale } from '@/i18n/pseudoLocale';
import { useI18nStore } from '@/stores/i18nStore';
import { useToastStore } from '@/stores/toastStore';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { createLogger } from "@/lib/log";
import { idlePrefetch } from "@/lib/idlePrefetch";
import { AppKeyboardProvider, useAppKeyboard } from "@/lib/keyboard/AppKeyboardProvider";
import ShortcutCheatSheet from "@/lib/keyboard/ShortcutCheatSheet";
import WorkspaceShortcuts from "@/lib/keyboard/WorkspaceShortcuts";
import KeyboardNavMode from "@/lib/keyboard/KeyboardNavMode";
import { ModalStackProvider } from "@/lib/ui/ModalStackContext";
import { CARD_PADDING, TOOLS_BTN_COMPACT } from "@/lib/utils/designTokens";
import { lazyRetry } from "@/lib/lazyRetry";

initPseudoLocale();

const appLogger = createLogger("App");

// Dev-only "click a component → copy its source path" overlay (Ctrl+Shift+L).
// Conditional + lazy so the module and its chunk are absent from prod builds:
// in prod `import.meta.env.DEV` is replaced with `false`, the dynamic import is
// never referenced, and Rollup drops it.
const DevInspector = import.meta.env.DEV
  ? lazy(() =>
      import("@/lib/dev/DevInspector").then((m) => ({ default: m.DevInspector })),
    )
  : null;

// --- Startup freeze attribution (dev only) ----------------------------------
// The freeze watchdog reports `lastAction` when the main thread stalls, but the
// bootstrap only ever marked "appInit:start" — so every startup freeze looked
// identical and told us nothing about which phase blocked. We cache markAction
// once (the watchdog module is already loaded in dev by main.tsx) and call it
// synchronously at each phase boundary, so the next freeze report names the
// real culprit. Dynamic + dev-gated keeps the watchdog tree-shaken from prod.
let _markAction: ((s: string) => void) | null = null;
if (import.meta.env.DEV) {
  void import("./lib/debug/freezeWatchdog").then((m) => { _markAction = m.markAction; });
}
function markPhase(phase: string): void {
  if (!import.meta.env.DEV) return;
  performance.mark(`appInit:${phase}`);
  _markAction?.(`appInit:${phase}`);
}

/**
 * Silent error boundary for invisible components (renders null on error).
 * Logs the failure but doesn't show UI — used for BackgroundServices which
 * normally renders nothing.
 */
class SilentErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { hasError: boolean; retryCount: number }
> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRIES = 3;
  private static readonly BACKOFF_MS = [5_000, 15_000, 45_000];

  state = { hasError: false, retryCount: 0 };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch(error: Error) {
    appLogger.error(`silently failed (attempt ${this.state.retryCount + 1})`, { name: this.props.name, error: error instanceof Error ? error.message : String(error) });

    if (this.state.retryCount < SilentErrorBoundary.MAX_RETRIES) {
      const delay = SilentErrorBoundary.BACKOFF_MS[this.state.retryCount] ?? 45_000;
      this.retryTimer = setTimeout(() => {
        this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }));
      }, delay);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() { return this.state.hasError ? null : this.props.children; }
}

// Lazy-load overlays and background services — none needed for first paint.
// BackgroundServices hosts hooks that import domain stores (~300 KB deferred).
// lazyRetry instead of raw React.lazy: a failed chunk fetch (dev-server
// restart, post-deploy stale chunk) would otherwise cache the rejection
// forever and brick the overlay until a full page reload.
const BackgroundServices = lazyRetry(() => import("@/features/shared/components/layout/BackgroundServices"));
const CommandPalette = lazyRetry(() => import("@/features/shared/components/overlays/CommandPalette"));
const GuidedTour = lazyRetry(() => import("@/features/onboarding/components/GuidedTour"));
const TourSpotlight = lazyRetry(() => import("@/features/onboarding/components/TourSpotlight"));
const ExecutionMiniPlayer = lazyRetry(() => import("@/features/shared/components/overlays/executionPlayer/ExecutionMiniPlayer"));
const HealingToast = lazyRetry(() => import("@/features/overview/components/feedback/HealingToast").then(m => ({ default: m.HealingToast })));
const AlertToastContainer = lazyRetry(() => import("@/features/overview/sub_observability/components/AlertToastContainer").then(m => ({ default: m.AlertToastContainer })));
const NotificationCenter = lazyRetry(() => import("@/features/shared/components/feedback/notifications/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const ShareLinkHandler = lazyRetry(() => import("@/features/settings/sub_network/components/ShareLinkHandler").then(m => ({ default: m.ShareLinkHandler })));
const CompanionPanel = lazyRetry(() => import("@/features/plugins/companion/CompanionPanel"));
const AthenaOrbLayer = lazyRetry(() => import("@/features/plugins/companion/orb/AthenaOrbLayer"));
const AthenaGuideLayer = lazyRetry(() => import("@/features/plugins/companion/orb/AthenaGuideLayer"));
// Idle-prefetch list: same modules as the lazy() declarations above. Hits the
// V8 module cache so the corresponding lazy() resolves synchronously when the
// overlays mount (or when the user triggers them via Cmd+K, the floating
// monitor, etc.). The transform `.then(m => ({ default: m.X }))` used by some
// lazy() calls is unnecessary here — module identity matches by URL.
const LAZY_OVERLAY_IMPORTS = [
  () => import("@/features/shared/components/layout/BackgroundServices"),
  () => import("@/features/shared/components/overlays/CommandPalette"),
  () => import("@/features/onboarding/components/GuidedTour"),
  () => import("@/features/onboarding/components/TourSpotlight"),
  () => import("@/features/shared/components/overlays/executionPlayer/ExecutionMiniPlayer"),
  () => import("@/features/overview/components/feedback/HealingToast"),
  () => import("@/features/overview/sub_observability/components/AlertToastContainer"),
  () => import("@/features/shared/components/feedback/notifications/NotificationCenter"),
  () => import("@/features/settings/sub_network/components/ShareLinkHandler"),
  () => import("@/features/plugins/companion/CompanionPanel"),
  () => import("@/features/plugins/companion/orb/AthenaOrbLayer"),
  () => import("@/features/plugins/companion/orb/AthenaGuideLayer"),
] as const;

function DevMobilePreviewShortcut() {
  useAppKeyboard((e) => {
    if (!import.meta.env.DEV || !(e.ctrlKey && e.shiftKey && e.key === 'M')) return false;
    e.preventDefault();
    toggleMobilePreview();
    window.location.reload();
    return true;
  }, { priority: 100 });

  return null;
}

export default function App() {
  const [consented, setConsented] = useState(hasUserConsented);
  const [isVersionBump] = useState(() => {
    const stored = storedConsentVersion();
    return stored !== null && !hasUserConsented();
  });
  // Defer heavy background services until UI is interactive
  const [bgReady, setBgReady] = useState(false);
  useEffect(() => {
    markPhase('start');
    // Dynamic imports: sequence bootstrap phases so cold-start IPC does not
    // contend with first-paint/sidebar data requests.
    void (async () => {
      markPhase('wiring');
      await Promise.all([
        import("@/lib/storeBusWiring").then(m => m.initStoreBus()),
        import("@/lib/eventBridge").then(m => m.initAllListeners()),
      ]);
      markPhase('middleware');
      await import("@/lib/execution/middleware").then(m => m.registerAllMiddleware());
      markPhase('wiring-done');

      // Orphan-draft cleanup: cancels every non-terminal session left over
      // from the previous app run. Deferred behind requestIdleCallback so
      // it never gates first paint — power users with several stale drafts
      // were paying ~500-800ms of additive cancel round-trips on cold start.
      const runBootstrap = () => {
        markPhase('bootstrap-sessions');
        import("@/lib/buildSessionBootstrap")
          .then(m => m.bootstrapActiveBuildSessions())
          .catch((err) => {
            appLogger.error("buildSessionBootstrap failed", { error: err instanceof Error ? err.message : String(err) });
          });
      };
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === "function") {
        ric(runBootstrap, { timeout: 1000 });
      } else {
        setTimeout(runBootstrap, 1000);
      }
    })().catch((err) => {
      appLogger.error("Critical startup module failed to initialize", { error: err instanceof Error ? err.message : String(err) });
    });
    markPhase('auth-init');
    void useAuthStore.getState().initialize();
    // Test automation bridge — exposes window.__TEST__ for MCP-driven testing.
    // Loaded in dev builds always, or in production when PERSONAS_TEST_PORT is set
    // (Rust injects window.__PERSONAS_TEST_MODE__ = true via eval).
    if (import.meta.env.DEV || (window as unknown as Record<string, unknown>).__PERSONAS_TEST_MODE__) {
      // Sequence: bridge first so window.__TEST__ exists, then perfInstrument
      // can register its methods onto it. Both are no-cost no-ops in prod.
      void import("@/test/automation/bridge").then(() => import("@/test/automation/perfInstrument"));
    }

    // Report frontend time-to-interactive to the Rust backend.
    // __BOOT_TIME__ is set in index.html before any JS loads.
    const bootTime = (window as unknown as Record<string, unknown>).__BOOT_TIME__;
    if (typeof bootTime === "number") {
      const tti = performance.now() - bootTime;
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("report_frontend_ready", { ttiMs: tti }).catch(() => {});
      });
    }
    // Defer BackgroundServices: health digest, credential remediation, lab events
    // These trigger heavy IPC cascades that compete with UI rendering.
    const bgTimer = setTimeout(() => setBgReady(true), 4000);

    // Warm the V8 module cache for deferred overlay chunks. Drained one chunk
    // per idle slice (see idlePrefetch) and started after a short delay so the
    // burst of chunk evaluations stays out of the contended first-load window
    // where it surfaced as main-thread freezes. By the time the user presses
    // Cmd+K, the lazy() boundary resolves synchronously instead of paying
    // ~80–200 ms of chunk fetch + parse + evaluate on first open.
    const cancelPrefetch = idlePrefetch(LAZY_OVERLAY_IMPORTS, { initialDelayMs: 2000 });

    return () => {
      clearTimeout(bgTimer);
      cancelPrefetch();
    };
  }, []);

  const { t } = useTranslation();
  const language = useI18nStore((s) => s.language);
  const fontReady = useI18nStore((s) => s.fontReady);
  const { shouldAnimate } = useMotion();
  const isDocumentVisible = useDocumentVisibility();

  useEffect(() => {
    document.documentElement.dataset.documentVisible = String(isDocumentVisible);
    return () => {
      delete document.documentElement.dataset.documentVisible;
    };
  }, [isDocumentVisible]);

  // Toast a localized confirmation when the language changes (skip initial mount).
  const prevLanguageRef = useRef(language);
  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    useToastStore.getState().addToast(t.common.language_changed, 'success', 1600);
  }, [language, t]);

  const isMobilePreview = useMobilePreview();

  // Forward every commit to window.__PERF__ when present (set up by
  // src/test/automation/perfInstrument.ts in test mode). The lookup is one
  // object access per commit when __PERF__ is absent — well below Profiler's
  // own overhead, which the React docs note is "small enough not to need
  // disabling in production." Keeping the Profiler unconditional means
  // measurement can be turned on with PERSONAS_TEST_PORT against any build.
  const onRootRender = useCallback<ProfilerOnRenderCallback>((...args) => {
    const perf = (window as unknown as { __PERF__?: { recordRender?: ProfilerOnRenderCallback } }).__PERF__;
    perf?.recordRender?.(...args);
    // Dev-only jank attribution. A commit this long synchronously blocks the
    // main thread — exactly what the freeze watchdog catches but can't name.
    // We log it AND stamp `lastAction` so the next heartbeat/freeze report
    // points at the slow commit (mount vs update + duration) instead of the
    // useless "appInit:start". 120ms ≈ ~7 dropped frames; below that it's noise.
    if (import.meta.env.DEV) {
      const [id, phase, actualDuration] = args;
      if (actualDuration > 120) {
        const detail = `render:${id}:${phase} ${Math.round(actualDuration)}ms`;
        console.warn(`[slow-commit] ${detail}`);
        _markAction?.(detail);
      }
    }
  }, []);

  return (
    <Profiler id="app-root" onRender={onRootRender}>
    <VibeThemeProvider>
      <AppKeyboardProvider>
        <ModalStackProvider>
        <DevMobilePreviewShortcut />
        {DevInspector && (
          <Suspense fallback={null}>
            <DevInspector />
          </Suspense>
        )}
        <ShortcutCheatSheet />
        <WorkspaceShortcuts />
        <KeyboardNavMode />
        <MotionConfig reducedMotion={isDocumentVisible ? "user" : "always"}>
          <AriaLiveProvider>
        <div
          className={`app-safe-area flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground transition-opacity duration-150 ease-out ${fontReady ? 'opacity-100' : 'opacity-60'}`}
        >
          <a
            href="#main-content"
            className={`sr-only focus:not-sr-only focus:fixed focus:top-1 focus:left-1 focus:z-[9999] ${CARD_PADDING.compact} focus:rounded-input focus:bg-primary focus:text-primary-foreground focus:typo-body focus:font-medium focus:shadow-elevation-3 focus:outline-none focus:ring-2 focus:ring-ring`}
          >
            {t.chrome.skip_to_content}
          </a>
          <TitleBar />
          <FleetActivityStrip />
          {!consented && <FirstUseConsentModal onAccept={() => setConsented(true)} isVersionBump={isVersionBump} />}
          <UpdateBanner />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={language}
              className="flex flex-1 overflow-hidden"
              initial={shouldAnimate ? { opacity: 0, y: 4 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldAnimate ? { opacity: 0 } : { opacity: 1 }}
              transition={{ duration: shouldAnimate ? 0.18 : 0, ease: [0.22, 1, 0.36, 1] }}
            >
              <PersonasPage />
            </motion.div>
          </AnimatePresence>
          {bgReady && (
            <>
              <SilentErrorBoundary name="BackgroundServices">
                <Suspense fallback={null}>
                  <BackgroundServices />
                </Suspense>
              </SilentErrorBoundary>
              <Suspense fallback={null}>
                <HealingToast />
                <AlertToastContainer />
                <GuidedTour />
                <TourSpotlight />
                <ExecutionMiniPlayer />
                <CommandPalette />
                <NotificationCenter />
                <ShareLinkHandler />
                <CompanionPanel />
                <AthenaOrbLayer />
                <AthenaGuideLayer />
              </Suspense>
            </>
          )}
          <ChartGradientDefs />
          <ToastContainer />
          {/* Live-mode corner pop-ups for incoming team-channel messages. */}
          <LiveChannelOverlay />
          {/* Global host for the credential resource-scope picker.
              Mounted at App root so the picker outlives parent unmounts
              when Catalog dispatches GO_LIST, autopilot panels reset,
              or edit forms close after save. */}
          <ResourcePickerHost />
          {/* Phase 2: approval gate for run-requests from the web dashboard. */}
          <RemoteApprovalPrompt />
          {import.meta.env.DEV && isMobilePreview && (
            <div className={`fixed top-1 right-1 z-[999] ${TOOLS_BTN_COMPACT} rounded-card bg-cyan-500/90 text-foreground typo-caption font-bold shadow-elevation-3 pointer-events-none select-none`}>
              {t.chrome.mobile_preview}
            </div>
          )}
        </div>
          </AriaLiveProvider>
        </MotionConfig>
        </ModalStackProvider>
      </AppKeyboardProvider>
    </VibeThemeProvider>
    </Profiler>
  );
}
