# Migration plan — xterm.js 6 + immer 11

Two major-version bumps deferred out of the 2026-06-01 `/npm-updates` pass. Both are
lower-risk than the version jump implies because this codebase uses a small, stable
slice of each library's surface. This doc is the plan; **no code has been changed yet.**

| Package | Current | Target | Blast radius |
|---|---|---|---|
| `@xterm/xterm` | `^5.5.0` | `^6.0.0` | 1 file (`fleetTerminalManager.ts`) + 5 addons + `vite.config.ts` |
| `@xterm/addon-fit` | `^0.10.0` | `^0.11.0` | bumps in lockstep with xterm 6 |
| `@xterm/addon-search` | `^0.15.0` | `^0.16.0` | **unused — candidate for removal instead** |
| `@xterm/addon-unicode11` | `^0.8.0` | `^0.9.0` | lockstep |
| `@xterm/addon-web-links` | `^0.11.0` | `^0.12.0` | lockstep |
| `@xterm/addon-webgl` | `^0.18.0` | `^0.19.0` | lockstep |
| `immer` | `10.2.0` (pinned) | `^11.1.8` | 1 file, 2 call sites (`triggerSlice.ts`) |

---

## Part 1 — xterm.js 6

### Why it's smaller than it looks

xterm 6's breaking changes are concentrated in options/renderers this app does not use.
Audit of the only consumer, `src/features/plugins/fleet/fleetTerminalManager.ts`:

```ts
const term = new Terminal({
  fontFamily: FONT_FAMILY,
  fontSize: effectiveFontSize(),
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: 5000,
  theme: themeFor(currentConfig.theme),
  allowProposedApi: true,
});
```

| xterm 6 breaking change | Used here? |
|---|---|
| Canvas renderer removed (use DOM or `@xterm/addon-webgl`) | ❌ Already on `WebglAddon` |
| `windowsMode` option removed | ❌ Not set |
| `fastScrollModifier` option removed | ❌ Not set |
| `overviewRulerWidth` → nested under `overviewRuler` | ❌ Not set |
| `EventEmitter` replaced by VS Code `Emitter` | ❌ No direct `EventEmitter` use |
| alt→ctrl+arrow keybinding hack removed | ❌ Not relied on |
| Viewport / scrollbar rewritten ("works very differently now") | ⚠️ **Behavioural — test scroll feel** |

Live setters in use (`term.options.fontSize`, `term.options.theme`) are stable API in v6.
Addons attached: `FitAddon`, `Unicode11Addon`, `WebLinksAddon`, `WebglAddon`.
**`@xterm/addon-search` is declared in `package.json` + `vite.config.ts` `optimizeDeps`
but never imported** — see step 2.

### Steps

1. **Bump in lockstep** (pre-6 addons are not v6-compatible — all six move together):
   ```jsonc
   // package.json
   "@xterm/xterm": "^6.0.0",
   "@xterm/addon-fit": "^0.11.0",
   "@xterm/addon-unicode11": "^0.9.0",
   "@xterm/addon-web-links": "^0.12.0",
   "@xterm/addon-webgl": "^0.19.0",
   // @xterm/addon-search — see step 2
   ```
   Then `npm install` (regenerates `package-lock.json` — the file CI's `npm ci` reads).
2. **Decide on `addon-search`:** it is unused. Either **drop it** (`npm uninstall
   @xterm/addon-search`, remove the line from `vite.config.ts` `optimizeDeps`) — preferred —
   or, if terminal search is on the roadmap, bump it to `^0.16.0` and actually wire it.
3. **Clear the Vite pre-bundle cache:** `rm -rf node_modules/.vite`. The xterm stack is
   hand-listed in `vite.config.ts` `optimizeDeps.include`; only the resolved versions
   change, not the list, but a stale optimize cache will pin the old major.
4. **Build:** `npx tsc --noEmit` then `npx vite build` (or `npm run tauri:dev:lite` for a
   live terminal).

### Manual test checklist (Fleet terminal)

The viewport/scrollbar rewrite (xterm #5096) is the one behavioural risk — exercise it:

- [ ] A Fleet session terminal renders text and streams PTY output.
- [ ] `FitAddon` resizes correctly on pane resize (`scheduleFit`).
- [ ] Live font-size change (`term.options.fontSize`) reflows.
- [ ] Live theme change (`term.options.theme`) restyles without re-creating the terminal.
- [ ] **Scroll** behaves: wheel scroll, scroll-to-bottom on new output, `scrollback: 5000`
      retention when switching active sessions (the manager keeps a terminal per session).
- [ ] Web links are clickable (`WebLinksAddon`).
- [ ] WebGL renderer attaches without console errors (`WebglAddon`); confirm no canvas-
      renderer fallback warning (canvas is gone in v6).

### Opportunities unlocked by v6 (optional follow-ups, not part of the bump)

- **Synchronized output (DEC 2026)** — eliminates mid-frame tearing for high-volume agent
  output. Directly relevant to Fleet terminals streaming fast CLI sessions. Best ROI.
- **OSC52 clipboard** — copy from within the PTY stream.
- **`onWriteParsed`** — post-write hook, useful for output-driven UI signals.
- **Progress addon** — terminal progress reporting.

### Rollback

Revert the `package.json` ranges + `package-lock.json` and re-run `npm install`; clear
`node_modules/.vite`. No schema/IPC/binding surface is touched, so rollback is purely a
dependency revert.

---

## Part 2 — immer 11

### Current usage

`immer` is pinned to exact `10.2.0` and used in exactly **one file, two call sites** —
`src/stores/slices/pipeline/triggerSlice.ts`:

```ts
set(produce((draft: PipelineStore) => { draft.triggerRateLimits[triggerId] = newState; }));
// and
set(produce((draft: PipelineStore) => {
  const entry = draft.triggerRateLimits[triggerId];
  if (!entry) return;
  entry.concurrentCount = Math.max(0, entry.concurrentCount - 1);
  entry.queueDepth = Math.max(0, entry.queueDepth - 1);
}));
```

No `zustand/middleware/immer` usage anywhere in the tree — these two `produce()` calls are
the entire immer footprint.

### Breaking change assessment

immer 11.0 is mostly an internal finalization rewrite (~20% faster). The one documented
behaviour change is **loose iteration becomes the default**. Both call sites do plain
object/map property mutation — no iteration over draft collections — so the loose-iteration
default does not affect them.

- **Do NOT** opt into the 11.1 `enableArrayMethods` plugin: it changes "safe to mutate a
  draft" semantics (callback args are no longer Proxy-wrapped). Irrelevant here and a
  footgun if enabled globally.
- immer v11 release notes do **not** document a dropped Node/ES target or removed public
  API. If a minimum-Node/ES-target claim ever matters, verify against the published
  `engines` field on npm before relying on it.

### Two paths (pick one)

**Path A — bump to `^11.1.8` (lowest churn):**
1. `package.json`: `"immer": "^11.1.8"` (also un-pins it from the exact version).
2. `npm install`.
3. `npx tsc --noEmit` + run the trigger-slice tests (`npm run test -- triggerSlice` or the
   pipeline store tests) to confirm the two rate-limit mutations still behave.

**Path B — drop immer entirely (one fewer dependency):**
Since immer's whole footprint is two shallow updates, replace them with manual immutable
updates and remove the dependency:
```ts
set((s) => ({ triggerRateLimits: { ...s.triggerRateLimits, [triggerId]: newState } }));
```
Then `npm uninstall immer`. **Recommended evaluation** — near-zero benefit is lost and the
dependency disappears, but it changes a store slice so it warrants the same test pass as
Path A. Decide based on whether immer is expected to spread to other slices later.

### Rollback

Revert `triggerSlice.ts` (Path B) and/or the `package.json` range + `package-lock.json`,
then `npm install`.

---

## Sequencing

These two migrations are independent — do them in separate commits, either order. xterm 6
carries the only real behavioural risk (terminal scroll), so validate it live before
committing. immer 11 (Path A) is a one-line range bump gated by `tsc` + the trigger tests.

## Package-manager note

`node_modules` is currently pnpm-installed but CI runs `npm ci` against `package-lock.json`,
and the two lockfiles drift independently (they are never co-committed). Per the 2026-06-01
decision, dependency work uses **npm** so `package-lock.json` (the CI-authoritative file)
stays correct; `pnpm-lock.yaml` is knowingly left stale. Keep that consistent here.
