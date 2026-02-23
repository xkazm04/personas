import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { getVersion } from "@tauri-apps/api/app";
import App from "./App";
import { initSentry } from "./lib/sentry";
import { persistCrash } from "./lib/utils/crashPersistence";
import "./styles/globals.css";

async function bootstrap() {
  let appVersion = "dev";
  try {
    appVersion = await getVersion();
  } catch {
    // Not in Tauri context (browser dev, Storybook, etc.)
  }

  initSentry(appVersion);

  window.onerror = (_message, _source, _lineno, _colno, error) => {
    Sentry.captureException(error ?? new Error(String(_message)));
    persistCrash("window.onerror", error ?? _message);
  };

  window.addEventListener("unhandledrejection", (event) => {
    Sentry.captureException(
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason))
    );
    persistCrash("unhandledrejection", event.reason);
  });

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

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppWithBoundary />
    </React.StrictMode>
  );
}

bootstrap();
