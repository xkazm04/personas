// Debug diagnostics — dev only (tree-shaken in production builds)
if (import.meta.env.DEV) {
  import('./lib/debug/freezeDetector');
  import('./lib/debug/freezeWatchdog');
}
import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import App from "./App";
import { initSentry } from "./lib/sentry";
import { initAnalytics } from "./lib/analytics";
import { isTelemetryEnabled } from "./lib/telemetryPreference";
import { persistCrash } from "./lib/utils/crashPersistence";
import { createLogger } from "./lib/log";
import "./styles/globals.css";

const globalErrorLogger = createLogger("global-error");

// Copy for the top-level Sentry error boundary fallback. This renders when
// the React tree itself crashed, so useTranslation() may be unsafe here
// (the translation provider could be the thing that threw). A static lookup
// against navigator.language covers the 14 supported locales; unknown
// languages fall back to English.
type ErrorBoundaryCopy = { title: string; generic: string; retry: string };
const EN_ERROR_COPY: ErrorBoundaryCopy = {
  title: "Something went wrong",
  generic: "An unexpected error occurred",
  retry: "Try again",
};
const ERROR_BOUNDARY_COPY: Record<string, ErrorBoundaryCopy> = {
  en: EN_ERROR_COPY,
  es: { title: "Algo salió mal", generic: "Ocurrió un error inesperado", retry: "Reintentar" },
  fr: { title: "Une erreur s'est produite", generic: "Une erreur inattendue s'est produite", retry: "Réessayer" },
  de: { title: "Etwas ist schiefgelaufen", generic: "Ein unerwarteter Fehler ist aufgetreten", retry: "Erneut versuchen" },
  zh: { title: "出现错误", generic: "发生意外错误", retry: "重试" },
  ja: { title: "エラーが発生しました", generic: "予期しないエラーが発生しました", retry: "再試行" },
  ko: { title: "오류가 발생했습니다", generic: "예기치 않은 오류가 발생했습니다", retry: "다시 시도" },
  ru: { title: "Что-то пошло не так", generic: "Произошла непредвиденная ошибка", retry: "Повторить" },
  cs: { title: "Něco se pokazilo", generic: "Došlo k neočekávané chybě", retry: "Zkusit znovu" },
  ar: { title: "حدث خطأ ما", generic: "حدث خطأ غير متوقع", retry: "حاول مرة أخرى" },
  hi: { title: "कुछ गलत हो गया", generic: "एक अप्रत्याशित त्रुटि हुई", retry: "पुनः प्रयास करें" },
  id: { title: "Ada yang tidak beres", generic: "Terjadi kesalahan tak terduga", retry: "Coba lagi" },
  vi: { title: "Đã xảy ra lỗi", generic: "Đã xảy ra lỗi không mong muốn", retry: "Thử lại" },
  bn: { title: "কিছু ভুল হয়েছে", generic: "একটি অপ্রত্যাশিত ত্রুটি ঘটেছে", retry: "আবার চেষ্টা করুন" },
};

function errorBoundaryCopy(): ErrorBoundaryCopy {
  try {
    const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    return ERROR_BOUNDARY_COPY[lang] ?? EN_ERROR_COPY;
  } catch {
    return EN_ERROR_COPY;
  }
}

// -- Global error handlers (sync, before React) ------------------------------
// Registered immediately so no early crash is silently lost.
// Sentry capture is deferred until initSentry() completes in the async phase;
// a flag flips once Sentry is ready.

let sentryReady = false;

/** Collect active persona + route so crash logs carry runtime context. */
function getErrorContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = { route: window.location.hash || window.location.pathname };
  try {
    const stored = localStorage.getItem("persona-ui-agents");
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { selectedPersonaId?: string | null } };
      if (parsed?.state?.selectedPersonaId) {
        ctx.personaId = parsed.state.selectedPersonaId;
      }
    }
  } catch { /* intentional: store may not exist yet */ }
  return ctx;
}

window.onerror = (_message, _source, _lineno, _colno, error) => {
  const ctx = getErrorContext();
  const err = error ?? new Error(String(_message));
  globalErrorLogger.error("Uncaught synchronous error", {
    message: err instanceof Error ? err.message : String(err),
    source: _source ?? undefined,
    line: _lineno ?? undefined,
    col: _colno ?? undefined,
    ...ctx,
  });
  if (sentryReady) {
    try { Sentry.captureException(err); } catch { /* intentional no-op */ }
  }
  persistCrash("window.onerror", err);
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  // Suppress Tauri IPC "send before connect" noise — fires in bulk when
  // the Rust backend emits events before the WebView IPC bridge is ready.
  // These are harmless (events are re-fetched on connect) and generate
  // tens of thousands of log lines otherwise.
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg === "send was called before connect") return;

  const ctx = getErrorContext();
  globalErrorLogger.error("Unhandled promise rejection", {
    message: msg,
    ...ctx,
  });
  if (sentryReady) {
    try {
      Sentry.captureException(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    } catch { /* intentional no-op */ }
  }
  persistCrash("unhandledrejection", reason);
});

// -- Render React immediately (sync) -----------------------------------------
// On Android WebView, async bootstrap can hang if Tauri IPC promises never
// resolve. Render first, then set up Sentry asynchronously.

const root = document.getElementById("root");
if (root) {
  try {
    const AppWithBoundary = Sentry.withErrorBoundary(App, {
      fallback: ({ error, resetError }) => {
        const copy = errorBoundaryCopy();
        return (
          <div
            role="alert"
            style={{
              padding: "2rem",
              fontFamily: "system-ui, sans-serif",
              color: "var(--foreground, #fff)",
              background: "var(--background, #1a1a1a)",
              height: "100vh",
              display: "flex",
              flexDirection: "column" as const,
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
            }}
          >
            <h1 style={{ fontSize: "1.5rem", margin: 0 }}>{copy.title}</h1>
            <p
              style={{
                opacity: 0.7,
                maxWidth: "400px",
                textAlign: "center" as const,
                margin: 0,
              }}
            >
              {error instanceof Error ? error.message : copy.generic}
            </p>
            <button
              onClick={resetError}
              style={{
                padding: "0.5rem 1.5rem",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                marginTop: "0.5rem",
              }}
            >
              {copy.retry}
            </button>
          </div>
        );
      },
    });

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <AppWithBoundary />
      </React.StrictMode>
    );
  } catch (e) {
    globalErrorLogger.error("Render with error boundary failed", { error: e instanceof Error ? e.message : String(e) });
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
} else {
  globalErrorLogger.error("#root element not found");
}

// -- Async setup (Sentry, analytics) -----------------------------------------
// Runs after React is already mounted and error handlers are active.
// Only Sentry enrichment and analytics are deferred here.

// Wire store monitoring for freeze diagnostics (dev only — zero overhead in production)
if (import.meta.env.DEV) (async () => {
  try {
    const [{ monitorStore }, { useSystemStore }, { useAgentStore }] = await Promise.all([
      import("./lib/debug/storeMonitor"),
      import("./stores/systemStore"),
      import("./stores/agentStore"),
    ]);
    monitorStore(useSystemStore, 'systemStore');
    monitorStore(useAgentStore, 'agentStore');
    // Lazy stores monitored when they load
    import("./stores/overviewStore").then(({ useOverviewStore }) => monitorStore(useOverviewStore, 'overviewStore')).catch(() => {});
    import("./stores/vaultStore").then(({ useVaultStore }) => monitorStore(useVaultStore, 'vaultStore')).catch(() => {});
  } catch { /* dev-only monitoring, safe to ignore */ }
})();

(async () => {
  let appVersion = "dev";
  try {
    appVersion = await getVersion();
  } catch {
    // non-critical: not in Tauri context or plugin not available
  }

  if (isTelemetryEnabled()) {
    try {
      initSentry(appVersion);
      sentryReady = true;
    } catch (e) {
      console.warn("[main] Sentry init failed:", e);
    }

    // Feature usage analytics -- subscribes to Zustand store navigation changes
    try {
      const { useSystemStore } = await import("./stores/systemStore");
      initAnalytics(useSystemStore.subscribe);
    } catch (e) {
      console.warn("[main] Analytics init failed:", e);
    }
  }
})();
