# Marathon — Session 1 handoff

Recorded 2026-05-19 ~22:55 local. Session ran 7 smoke attempts. None
landed; each surfaced a different layer.

## What's fixed

1. **ESM `__dirname` in spec + fixtures** (`4f0d2eae9`).
2. **`/eval` field name `code` → `js`** (was silently making every
   `/eval` click a no-op; the Adopt button never received a real
   click in any of the early smoke runs). Found via probe5–probe9
   debugging.
3. **Wrong template tab** — was clicking `template-tab-recipes`;
   removed since `templateTab === 'generated'` is the default.
4. **Bridge cold-start warm-up** — 90s `getState()` readiness loop
   before phase 1.
5. **Phase 1 row-walk path** — iterates rendered `[data-testid^=
   "template-row-"]` rows, finds the one matching template name,
   clicks to expand, then clicks Adopt.

## What's blocked

**`/eval` queue going silent mid-session.** Reproduced cleanly at
22:50:
- HTTP `POST /eval` returns `{"success":true}` for any payload.
- The dispatched JS does NOT execute. Sequential probes confirm:
  - `probe2` (first eval of the session) — DOM mutation visible.
  - `probe5` through `probe10` (later evals) — no DOM mutation despite
    success response.
  - Setting `window.__MARATHON_RAN__ = true` and reading it back in a
    follow-up eval: never gets set.

The Tauri `webview.eval(req.js)` call appears to silently drop
queued scripts after some trigger. Could be:
- WebView reaching a script-queue limit (Windows WebView2 quirk).
- A prior eval (e.g. one that mutated React state) leaving the
  webview in a state where script eval is suppressed.
- Background script-thread getting throttled / hung.

App restart will clear the queue state. The spec needs a workaround
that doesn't lean on `/eval` for click dispatch — use
`/click-testid` exclusively (which uses a different code path: bridge
method invocation via `__test_respond`).

## Recommended next moves (next CC session)

1. **Restart the app** — that clears the /eval queue state per the
   pattern.
2. **Re-engineer phase 1 to use `clickTestId` only**:
   - Walk rows via `query('[data-testid^="template-row-"]')`, find
     match by `text` field (innerText) substring.
   - Get the testid of the match.
   - `clickTestId(testid)` to expand.
   - For Adopt: needs a testid too. ExpandedRowContent's Adopt button
     has no testid today → either add one (small source change), or
     find via `findText('Adopt')` then walk to a closest descendant.
3. **Add a `simulateNavigate` or similar bridge primitive** that does
   the whole "navigate → click row → click Adopt" sequence on the JS
   side in one shot. Avoids the /eval-or-clickTestId dichotomy and
   the queue brittleness.
4. **Consider testid coverage as a separate PR** — adding
   `data-testid="template-adopt-button"` to `ExpandedRowContent.tsx`
   would simplify the marathon and any future template E2E. This is
   a 1-line change worth landing.

## Honest state of the marathon

- The plan + harness foundation are sound.
- Smoke proved every layer needs UI inspection that takes more time
  than CC turns afford.
- 0/1 templates have actually been adopted via Glyph variant.
- The `/eval` queue brokenness is a Tauri-level finding worth
  investigating separately from the marathon.

The 50-template overnight ask is still achievable, but only after
phase 1 actually lands on a real adoption modal. That's a 1-2-hour
focused session on the next CC turn, not "kick off and let it run."
