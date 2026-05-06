# Playwright tests — Athena (companion) E2E

End-to-end tests for the companion plugin's chat flow. Drives the **real**
running Tauri app via the test-automation HTTP server. No browser launch,
no WebDriver — Playwright is used purely as a TS test runner. See
`docs/development/test-automation.md` for the underlying bridge architecture.

## Pre-req — start the app in test mode

```bash
# Dev mode (canonical)
npm run tauri:dev:test
# → Vite at :1420, Tauri WebView, axum HTTP bridge at 127.0.0.1:17320
```

To run tests against a production build instead:

```powershell
# PowerShell
$env:PERSONAS_TEST_PORT = "17321"
& "C:\Users\<you>\AppData\Local\Personas\personas-desktop.exe"
$env:COMPANION_TEST_PORT = "17321"
npm run test:playwright:companion
```

## Running

```bash
# Just the companion conversation suite
npm run test:playwright:companion

# Full Playwright suite
npm run test:playwright

# Single test, UI mode
npx playwright test --config=playwright.config.ts --ui
```

## What's in this folder

| File | Purpose |
| --- | --- |
| `companion-bridge.ts` | TS wrapper over the HTTP bridge (port 17320). Companion-specific helpers: `openChatPanel`, `resetConversation`, `sendAndAwait`, `snapshotPanel`, `brainEpisodeCount`, `factCounts`. |
| `athena-conversation.spec.ts` | 3-message round-trip + brain persistence + Memory tab smoke. |

## Why HTTP, not WebDriver?

- Tauri 2 + WebDriver on Windows is brittle.
- The HTTP bridge is already proven by 9 production smoke scenarios in `tools/test-mcp/`.
- Reusing it gives full-stack coverage with zero new moving parts; Playwright's contribution is `expect()`, parallel/serial scheduling, and the HTML reporter.

## Adding new tests

1. Plant `data-testid` attributes on the UI you want to drive (existing pattern — see `docs/development/test-automation.md`'s testid reference).
2. If the flow is companion-specific, add a helper to `companion-bridge.ts` so the spec stays declarative.
3. Spec files: `*.spec.ts` under `tests/playwright/`. Imports come from `./companion-bridge`.

## Why `workers: 1`?

The companion has a single backend session (`DEFAULT_SESSION_ID = "default"`). Parallel tests would corrupt the transcript. If you need parallelism later, the right move is per-test session ids, not multi-worker hacks.

## Timeouts

- Per-test default: **5 minutes**. A real Opus turn is 30-90 seconds; three of them plus reset/setup land around 4 minutes worst-case.
- `waitForReply()` defaults to 4 minutes — don't lower this without a reason. A real Claude call genuinely can take that long, and a flaky test is worse than a slow one.
