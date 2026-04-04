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
  const ctx = getErrorContext();
  const reason = event.reason;
  globalErrorLogger.error("Unhandled promise rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
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
      fallback: ({ error, resetError }) => (
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
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
          <p
            style={{
              opacity: 0.7,
              maxWidth: "400px",
              textAlign: "center" as const,
              margin: 0,
            }}
          >
            {error instanceof Error
              ? error.message
              : "An unexpected error occurred"}
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
            Try again
          </button>
        </div>
      ),
    });

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <AppWithBoundary />
      </React.StrictMode>
    );
  } catch (e) {
    console.error("[main] Render with error boundary failed:", e);
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
} else {
  console.error("[main] #root element not found");
}

// -- Async setup (Sentry, analytics) -----------------------------------------
// Runs after React is already mounted and error handlers are active.
// Only Sentry enrichment and analytics are deferred here.

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
