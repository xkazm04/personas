import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import App from "./App";
import { initSentry } from "./lib/sentry";
import { persistCrash } from "./lib/utils/crashPersistence";
import "./styles/globals.css";

// ── Render React immediately (sync) ─────────────────────────────────────
// On Android WebView, async bootstrap can hang if Tauri IPC promises never
// resolve. Render first, then set up Sentry/error handlers asynchronously.

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

// ── Async setup (Sentry, error handlers) ────────────────────────────────
// Runs after React is already mounted so the app is visible immediately.

(async () => {
  let appVersion = "dev";
  try {
    appVersion = await getVersion();
  } catch {
    // non-critical: not in Tauri context or plugin not available
  }

  try {
    initSentry(appVersion);
  } catch (e) {
    console.warn("[main] Sentry init failed:", e);
  }

  window.onerror = (_message, _source, _lineno, _colno, error) => {
    try { Sentry.captureException(error ?? new Error(String(_message))); } catch {}
    persistCrash("window.onerror", error ?? _message);
  };

  window.addEventListener("unhandledrejection", (event) => {
    try {
      Sentry.captureException(
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason))
      );
    } catch {}
    persistCrash("unhandledrejection", event.reason);
  });
})();
