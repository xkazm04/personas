# Audit Fix Wave 8 — Critical accessibility (Tier-2 continues)

> 5 commits, 5 of 6 critical a11y findings closed; 1 deferred (orphaned canvas, dead UI).
> Theme: surfaces a sighted-mouse user operates fine but a keyboard / screen-reader / color-blind user cannot — copy grids with no keyboard path, status conveyed by color alone, live updates painted silently, an unlabeled secret toggle, and a tooltip that stringified a React element.
> Baseline preserved: `tsc --noEmit` 0; eslint clean on every touched file.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `2c8b38e36` | overview #1 — annotation tooltip showed `[object Object]` | `overview/sub_observability/components/MetricsCharts.tsx` |
| `f67c2e461` | credential-vault #1 — secret toggle has no accessible name | `vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx` |
| `7cbf2bb78` | deployment #2 — status badge is color-only | `agents/sub_deployment/components/cloud/cloudDeploymentHelpers.ts`, `DeploymentCard.tsx` |
| `89953a942` | mcp #1 — SQL result grid is mouse-only | `vault/sub_databases/QueryResultTable.tsx` |
| `8147f3397` | companion #1 — replies/thinking/listening invisible to SR | `plugins/companion/CompanionPanel.tsx`, `Composer.tsx` |

## What was fixed

1. **overview #1** — the chart annotation `<title>` tooltip interpolated a React element (`<AbsoluteTime/>`) into a template literal, which stringifies to `[object Object]`. Both the line- and area-chart sites now format the ISO timestamp to a locale string via `Intl.DateTimeFormat` (guarded against an unparseable value with `Number.isFinite(Date.parse(...))`), with `·` as the label/time separator. Dropped the now-unused `AbsoluteTime` import.
2. **credential-vault #1** — the eye / eye-off button that reveals a captured secret had no accessible name and no pressed state, so a screen reader announced only "button". Added `aria-label` + `title` ("Show value" / "Hide value") and `aria-pressed={isVisible}`.
3. **deployment #2** — the deployment-card status badge distinguished active / paused / failed by color alone (WCAG 1.4.1). Added a `statusIcon()` helper (`CheckCircle2` / `PauseCircle` / `XCircle` / `Circle`) and rendered the glyph (aria-hidden, decorative) inside the badge so state reads by shape as well as color; the status word still carries the text label.
4. **mcp #1** — the query result grid bound copy-on-click to bare `<th>` / `<td>` with no keyboard path and no ARIA, so keyboard/SR users could neither trigger nor perceive the copy. Each interactive header and cell now has `tabIndex={0}`, `role="button"`, `onKeyDown` (Enter + Space → the same copy handler), a descriptive `aria-label`, and a focus-visible ring; a single visually-hidden `aria-live="polite"` region announces the copied value (truncated). Visual styling unchanged.
5. **companion #1** — the chat panel painted Athena's thinking/phase status, the completed reply, and the hot-mic dictation state silently (no live region anywhere in the panel). Added `role="status" aria-live="polite"` to the streaming status line; a visually-hidden `aria-live="polite"` mirror of the latest *completed* assistant turn (announced once `streaming` flips false and the full reply is in `messages`); and a `sr-only aria-live="assertive"` region in the composer driven by `dictation.listening`.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | clean |
| `cargo check` | n/a (no Rust this wave) |

## Deferred (1 of 6)

- **composition #1 — node-canvas keyboard/SR access.** Targets the `sub_canvas` ReactFlow surface, but `TeamCanvas` is a stub and no host route currently mounts it — the canvas is **dead UI**. Fixing a11y on an unmounted surface is unverifiable and would rot; deferred until the canvas is actually wired into a page. (Documented in the scan's scope note.)

## Patterns reinforced (catalogue, continued)

28. **Never interpolate a React element into a string.** A template literal (or any `String(...)`) coerces a JSX element to `[object Object]`. For `title`/`aria-label`/text contexts, format the underlying value to a string explicitly — don't reuse a display *component* meant for the DOM.
29. **Color is never the only signal (WCAG 1.4.1).** Status conveyed by a colored badge needs a second channel — a shape/glyph icon or text — so color-blind and low-vision users can still distinguish states.
30. **Click handlers belong on focusable controls.** An `onClick` on a `<div>`/`<td>`/`<th>` is invisible to keyboard and SR users. Add `tabIndex`, `role="button"`, an Enter/Space `onKeyDown`, an `aria-label`, and a visible focus ring — or use a real `<button>`.
31. **Async/streamed UI updates need a live region.** Content that appears without a focus change (a streamed reply, a "Copied" flash, a "Listening…" state) is silent to SR unless mirrored into an `aria-live` region — `polite` for replies/confirmations, `assertive` for state the user must know *now* (mic hot). Mirror the *value*, not the styled element, and gate it so it changes exactly once per event.

## Cumulative status

| Tier | Wave | Theme | Closed |
|---|---|---|---|
| 1 | 1 | Lost-update writes | 8/8 |
| 1 | 2 | Transition guards & lock leaks | 5/7 |
| 1 | 3 | Success theater | 4/7 |
| 1 | 4 | Orphaned processes | 5/5 |
| 1 | 5 | Security | 6/7 |
| 1 | 6 | Corruption loops & integrity | 5/7 |
| 2 | 7 | Error-blind UI surfaces | 6/7 |
| 2 | 8 | Critical accessibility | 5/6 |
| | | **Total criticals fixed** | **44** |

Remaining: Tier-2 Wave 9 (destructive-confirm + broken UI, 6); the 10 deferred items (8 Tier-1 + research-lab #1 + canvas composition #1); and the 169 Tier-3 highs.
