# Rendering untrusted content

> **Leaf:** `ui-system / copy-and-vocabulary / rendering-untrusted-content` · recurrence 103
> **Composed:** 2026-08-14 · **Sweep:** ~30 files read in full, plus tree-wide scans over
> 4,829 TS/TSX files and 963 Rust files (counts from
> [`shared-facts.json`](../shared-facts.json), commit `211d519bb`), the two sibling
> repos `../personas-web` and `../brainiac/console`, and the installed
> `react-markdown@10.1.0` source in `node_modules`.

## Headline: the brief's P0 premise did not survive measurement

The commissioning brief asked me to treat this as the security leaf of the UI layer and
to expect live findings: "an XSS here is not a session-cookie problem, it is arbitrary
local command execution." The *consequence* is stated correctly — `withGlobalTauri: true`
is real ([`src-tauri/tauri.conf.json:16`](../../../src-tauri/tauri.conf.json)) and any
script executing in this renderer reaches the full 1,661-command IPC surface. **But the
antecedent is not satisfied anywhere in this tree.** Measured:

| Signal | Result |
| --- | --- |
| `dangerouslySetInnerHTML` occurrences | **5, in 4 files** (+4 in JSDoc prose) |
| …of those, unsanitized | **0** |
| Markdown raw-HTML passthrough (`rehype-raw`) | **not installed** — raw HTML is dropped, never parsed |
| `javascript:` / `data:` reaching an `href` | **0** — blocked twice over (§ below) |
| `<a target="_blank">` without `rel` | **0 of 32** |
| Production `script-src` containing `'unsafe-inline'` / `'unsafe-eval'` | **neither** |
| Sanitizer dependency | `dompurify@^3.4.2`, wrapped in 3 helpers, 100% adoption at the dSIH sites |

**There is no live XSS finding in this repo, and I could not manufacture one.** A cleared
security claim is worth as much as a confirmed one, so this document's job is different
from what the brief anticipated: it records *why* the floor holds, names the two load-bearing
controls that hold it, and gates the one that is currently protected by nothing at all.

The brief also predicted the shape "a sanitizer that exists and guards the wrong surface."
That shape **is** present — but inverted. The sanitizers guard the right surfaces. What is
unguarded is the **Content-Security-Policy string itself**: it is doing more of the work
than any sanitizer, it lives in one unreviewed JSON field, and no test, lint rule, or check
script asserts anything about it (§7 D1, §9).

---

## 1. Trigger

You are in this situation when any of these is true:

- "I need to render the model's answer / the agent's summary / this tool's output."
- "This content has markdown in it — bold, links, a code block."
- "I'm showing a connector's API response / a subprocess's stdout / a file the user picked."
- "I want to bold one word inside a translated sentence, so I'll interpolate `<strong>`."
- "The persona description / memory / note body should render nicely, not as a wall of text."
- **The "about to write X" test:** you are about to type `dangerouslySetInnerHTML`,
  `.innerHTML =`, `<ReactMarkdown>`, `href={someVariable}`, `src={someVariable}`, or
  `openExternalUrl(someVariable)`.

If the string was authored by a translator, [`i18n-string-authoring.md`](./i18n-string-authoring.md)
owns it; if it is a toast body, [`toasts.md`](./toasts.md) owns it. **This path owns any
string whose author is not the repo** — LLM output, subprocess stdout, connector responses,
user-authored prompts and notes, file contents — regardless of which of those surfaces it
lands on.

## 2. The one way

**Render untrusted content as React children and stop.** React escapes text nodes, so
`<div>{content}</div>` is already safe and needs no sanitizer, no helper, and no review.
If the content is markdown, pass it to `MarkdownRenderer` — never to a bare
`<ReactMarkdown>` — because the shared renderer is where the link, image and code-block
policy lives. If you genuinely need HTML in the DOM (exactly two justifications exist in
this repo: syntax highlighting, and bolding one span inside a translated sentence), the
string must be built by a helper in `sanitizers/sanitizeHtml.ts` that returns
DOMPurify-sanitized output under an explicit tag allowlist, and the `dangerouslySetInnerHTML`
must sit on the same line as that helper call so a reviewer sees both at once. For any URL
that came with the content, sanitize before it becomes an `href`/`src` and route external
opens through `openExternalUrl` — never through `@tauri-apps/plugin-shell`, which this app
does not ship (§7 D2).

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `shared/components/editors/MarkdownRenderer` | The only sanctioned markdown surface. 49 consumer files. Owns `a` (sanitized href + `target="_blank" rel="noopener noreferrer"`), code-block chrome, tables, and the `<thinking>`/`[META]` strip. |
| `lib/utils/sanitizers/sanitizeHtml#sanitizeHljsHtml` | DOMPurify with `ALLOWED_TAGS: ['span']`, `ALLOWED_ATTR: ['class']`. The only correct way to put highlight.js output in the DOM. |
| `lib/utils/sanitizers/sanitizeHtml#sanitizeRichSummary` | Escapes first, converts `**bold**` to `<strong>`, then DOMPurify with `ALLOWED_TAGS: ['strong']`. For LLM-authored summary strings. |
| `lib/utils/sanitizers/sanitizeHtml#escapeHtml` | Escapes `& < > " '`. For interpolating an untrusted value into an HTML fragment you are assembling. |
| `lib/utils/sanitizers/sanitizeHtml#stripHtml` | DOMPurify with everything denied — returns text only. Defence-in-depth for AI-generated text rendered as React children. |
| `lib/utils/sanitizers/sanitizeUrl#sanitizeExternalUrl` | `string \| null`. http/https only; rejects embedded credentials and 20 classes of unicode control/bidi codepoint used to disguise a scheme. **Returns `null`, which forces the caller to branch.** |
| `lib/utils/sanitizers/sanitizeUrl#sanitizeIconUrl` | https-only *and* blocks private/loopback/`.local` hosts. For an image `src` that came with the content. |
| `api/system/system#openExternalUrl` | The IPC chokepoint to the OS browser. The Rust side re-validates http/https (`commands/infrastructure/system/mod.rs:18-31`), so it is a real boundary, not a convention. |

Do **not** reach for `@tauri-apps/plugin-shell`'s `open()`. It is in `package.json` but the
`tauri-plugin-shell` crate is absent from `Cargo.toml` and no capability grants `shell:`.

## 4. Steps

1. **Ask what the author of this string is.** Repo/translator → not this path. Anything else
   → continue.
2. **Default: render as children.** `<div>{content}</div>`. For most surfaces you are done
   here — this is the step people skip on their way to a sanitizer they did not need.
3. **Markdown? Use `MarkdownRenderer`.** Import from
   `@/features/shared/components/editors/MarkdownRenderer`, pass `content`, stop. Do not pass
   `rehypePlugins`, do not add `rehype-raw`, do not build a local `components` map.
4. **HTML fragment genuinely required?** Write (or reuse) a helper in `sanitizeHtml.ts` that
   ends in `DOMPurify.sanitize(..., { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })` with the
   narrowest possible allowlist, and call it inline at the `__html` site:
   `dangerouslySetInnerHTML={{ __html: sanitizeRichSummary(x) }}`. **And then stop** — the
   helper owns the policy; the call site must not add to it.
5. **URLs from the content**: `sanitizeExternalUrl` before an `href`, `sanitizeIconUrl` before
   an `img src`, and handle the `null` branch by degrading to plain text (see
   `MarkdownRenderer.tsx:307-315` for the pattern). For "open this in the browser", call
   `openExternalUrl(safe)`.
6. **Before adding a gate, ask the contract's question — can the signature make this
   impossible?** See §9's type-over-gate answer: for `img`/`a` the answer is yes and the fix
   belongs in the primitive; for `dangerouslySetInnerHTML` the answer is no, because React
   puts that prop on every element.

## 5. Anti-patterns

- **Reaching for DOMPurify when React children would do.** `stripHtml(x)` inside
  `<div>{...}</div>` is not safer than `<div>{x}</div>` — it is the same safety plus a
  1.2 kB round-trip and a reader who now believes the plain case is unsafe. The failure mode
  is doctrinal drift: once sanitizing looks mandatory everywhere, the sites where it is
  genuinely load-bearing stop standing out.
- **Adding `rehype-raw` "so the markdown supports HTML".** This single dependency converts
  every LLM response in the app into an HTML injection vector, and it does so silently —
  nothing else in the pipeline changes. It is the one change that would move this leaf from
  "clean" to "critical".
- **A bare `<ReactMarkdown>` with no `components`.** You inherit react-markdown's protocol
  guard (good) but skip the repo's stricter URL policy, and you emit `<a>` with no `target`
  and no `rel` — which in a Tauri webview means a click can navigate the **main app window**
  to a remote page, with no address bar to tell the user where they now are (§7 D3).
- **`el.innerHTML = ...` to swap in a fallback.** It is invisible to React (which will
  overwrite or be confused by it), invisible to the `react/no-danger` family, and invisible to
  the §9 census rule, which keys on the React prop. See §7 D4.
- **Trusting `sanitizeExternalUrl` and then calling `openExternal`.** Sanitizing a value and
  handing it to a function that cannot run is not defence in depth; it is a dead button that
  looks maintained (`ProjectOverviewPage.tsx:249` does exactly this).
- **Widening a DOMPurify allowlist at the call site.** The allowlists in `sanitizeHtml.ts`
  are `['span']`, `['strong']`, `[]`. Each is the minimum for its one job. A call site that
  wants `<a>` or `<img>` has outgrown `dangerouslySetInnerHTML` and should be using
  `MarkdownRenderer`.
- **Arguing severity from the CSP.** The CSP is why the residual risk here is low, but it is
  one string in one file that no gate protects. Do not let it justify a weaker call site.

## 6. Evidence

**The one site to copy: [`src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:159`](../../../src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx).**

```tsx
dangerouslySetInnerHTML={{ __html: sanitizeRichSummary(llmSummary ?? summary ?? '') }}
```

Directly LLM-authored content, the escape hatch taken deliberately, the sanitizer named on
the same line, and the policy (`ALLOWED_TAGS: ['strong']`) owned one import away rather than
inline. A reviewer needs no context beyond this line to approve it.

Supporting sites:

- [`src/lib/utils/sanitizers/sanitizeHtml.ts:52-62`](../../../src/lib/utils/sanitizers/sanitizeHtml.ts) —
  `sanitizeRichSummary` escapes *before* it introduces markup, so its own `<strong>` insertion
  cannot be forged by input that already contained `**`.
- [`src/features/shared/components/editors/MarkdownRenderer.tsx:307-315`](../../../src/features/shared/components/editors/MarkdownRenderer.tsx) —
  the `a` override: sanitize, and on `null` **degrade to a `<span>`** rather than rendering a
  dead `href`. This is the better half of a convergence disagreement (§ Convergence).
- [`src/features/vault/sub_catalog/components/design/setup/setupMarkdownComponents.tsx:80-98`](../../../src/features/vault/sub_catalog/components/design/setup/setupMarkdownComponents.tsx) —
  the *other* link idiom: render a `<button>` that calls `onOpenUrl(safeUrl)`, disabled when
  unsafe. In a Tauri webview this is the idiom that provably works, because it routes through
  the validated IPC command instead of relying on webview `target="_blank"` behaviour.
- [`src-tauri/src/commands/infrastructure/system/mod.rs:18-31`](../../../src-tauri/src/commands/infrastructure/system/mod.rs) —
  the backend half: `open_external_url` re-validates the scheme in Rust, so the 6 frontend
  call sites that forget to sanitize are still contained.

### The two controls actually holding the floor

Both were found by measurement, and neither is visible from a call site:

1. **`react-markdown@10.1.0` blanks dangerous schemes before any component sees them.**
   No call site in this repo passes `urlTransform`, so `defaultUrlTransform` is active at all
   7 of them, and `safeProtocol` is `/^(https?|ircs?|mailto|xmpp)$/i`
   (`node_modules/react-markdown/lib/index.js:124,320,382,421`). `javascript:`, `data:` and
   `vbscript:` become `''` in both `href` and `src` **before** `sanitizeExternalUrl` ever runs.
   The repo's own sanitizer is the second layer, not the first.
2. **The production CSP has no `'unsafe-inline'` and no `'unsafe-eval'` in `script-src`**
   (`tauri.conf.json:44`). `script-src 'self' https://www.youtube.com https://s.ytimg.com`,
   plus `object-src 'none'` and `base-uri 'self'`. An injected `<script>` or an
   `onerror=` attribute would not execute even if a sanitizer were removed. `img-src` is an
   8-entry allowlist, so an image beacon to an arbitrary host is blocked too.

**This is the finding that matters most, and it cuts against the brief's framing.** The
XSS→IPC→local-command-execution chain the brief describes is genuine in structure, but it is
severed at its first link by a CSP that no call site knows about and no gate protects.

## 7. Deviations

**D1 — the CSP is load-bearing and completely ungated. (P1, highest leverage.)**
`scripts/check-tauri-configs.mjs` validates `$schema` drift, overlay key surface, and
Cargo feature existence — it never reads `csp` or `devCsp`. `eslint.config.js` has no
`react/no-danger`. No test in `src/test/` or `src-tauri/tests/` asserts on
Content-Security-Policy. A one-word edit adding `'unsafe-inline'` to `script-src` — the
single most common CSP regression, usually added to make some inline snippet work — passes
`npm run check`, all 2,400+ Vitest tests, and CI. The control that reduces every other item
in this section from "vulnerability" to "defence-in-depth gap" is protected by nothing.

**D2 — 7 call sites in 6 files call a shell plugin that is not installed. (P1, functional.)**
`@tauri-apps/plugin-shell@^2.3.5` is in `package.json`, but `tauri-plugin-shell` is absent
from `src-tauri/Cargo.toml` and neither `capabilities/default.json` nor `mobile.json` grants
`shell:`. Every one of these silently fails:

| Site | What the user sees fail |
| --- | --- |
| `vault/sub_credentials/components/gateway/PendingAuthModal.tsx:58` | "Authorize" in the pending-auth modal — a credential flow dead-end |
| `plugins/dev-tools/sub_runner/PrBridge.tsx:326` | "Open PR on GitHub" |
| `plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx:249` | repo tiles (sanitizes correctly, then calls the dead function) |
| `plugins/twin/shared/WikiFreshnessPill.tsx:108` | "Open folder" |
| `plugins/artist/sub_media_studio/MediaStudioPage.tsx:584,587` | "Play exported file" / "Show folder" |
| `plugins/artist/sub_gallery/GalleryPage.tsx:159` | "Open artist folder" |

Fix: `openExternalUrl` for http(s), `openLocalPath` for paths and editor schemes. Both
already exist and both are validated in Rust. Security-neutral, but it is the exact
"guards the wrong surface" shape the brief predicted — here a *capability* everyone assumed
existed, does not.

**D3 — 2 bare `<ReactMarkdown>` renderers on user/LLM content. (P2.)**
`plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:291` (Obsidian note bodies) and
`teams/sub_canvas/components/nodes/StickyNoteNode.tsx:150` (canvas note text) render with
`remarkPlugins={[remarkGfm]}` and **no `components` map**. Scheme safety still holds via
`defaultUrlTransform`, so this is not injectable. What is lost: the repo's stricter URL policy
(credentials, bidi/zero-width obfuscation), and the `target`/`rel` pair. There is no
`on_navigation` guard on the main window — `auth.rs:459,586` install one only on the two OAuth
popups — so a plain `<a href="https://…">` can navigate the whole app window to a remote page
with no address bar. *Not verified at runtime;* WebView2 may suppress the navigation. Fix
either way: use `MarkdownRenderer`.

**D4 — one raw `innerHTML` write, invisible to the §9 signal.**
`overview/sub_manual-review/components/FocusedDecisionCard.tsx:73` sets
`el.parentElement.innerHTML` in an `onError` handler. The interpolated value is a translation
string, so it is **not** injectable — but it is a raw HTML write into a React-owned subtree,
and the census rule in §9 cannot see it. Recorded here so the gap in my own signal is on the
record rather than implied.

**D5 — `img src` passes through unchecked in all 3 markdown component maps.**
`MarkdownRenderer.tsx:320-322` and `ChatMessageContent.tsx:201` override `img` and forward
`src` unchanged; `setupMarkdownComponents.tsx` does not override `img` at all.
`sanitizeIconUrl` exists for precisely this and is used at none of them.

> **This is a re-raise, and it corrects the original.**
> [`.perfect/directions/untrusted-card-content.md`](../../../.perfect/directions/untrusted-card-content.md)
> found this on 2026-08-05, was rejected at the gate for blast radius, and closed with "the
> finding stands — re-raise it against whichever context owns
> `src/features/shared/components/editors/`." This document is that re-raise. **But its
> severity claim was overstated:** it said a crafted body "can make the desktop app fetch an
> attacker-controlled or internal URL on render." It cannot, in a packaged build — `img-src`
> is an 8-host allowlist, so both the attacker CDN and the internal probe are blocked, and
> `sanitizeIconUrl`'s private-host blocklist is largely redundant with it. The residue is
> real but narrow: `devCsp` adds `http://localhost:*` to `img-src`, so an internal-port probe
> works **in dev builds only**. Fix it because the component should not depend on a CSP it
> never mentions — not because a beacon fires today.

**D6 — 6 of 13 `openExternalUrl` call sites pass a dynamic value unsanitized.**
`plugins/radio/components/StationPicker.tsx:237`,
`vault/…/autoCred/helpers/TauriPlaywrightAdapter.ts:91`,
`vault/…/autoCred/display/AutoCredCards.tsx:21`,
`vault/…/autoCred/steps/AutoCredConsent.tsx:28`,
`plugins/dev-tools/sub_projects/ProjectManagerPage.tsx:346`, and
`plugins/companion/applyClientAction.ts:75` (an LLM-proposed approval action). All are
contained by the Rust prefix check, so none is exploitable for scheme abuse. What they lose
is the frontend layer's extras — embedded credentials and unicode/bidi disguise — which the
Rust side does not replicate. 5 sites sanitize first; 2 pass string literals.

## 8. Gaps

1. **`sanitizeExternalUrl` and the Rust `open_external_url` check are not the same check.**
   Rust does `trimmed.starts_with("https://") || starts_with("http://")`; the frontend parses
   the URL and additionally rejects credentials and 20 codepoint classes. The backend is the
   real boundary but the weaker filter, so D6's sites are contained against the severe case
   and open to the cosmetic one. Making them agree means porting `hasUnsafeCodepoints` to
   Rust — genuinely unbuilt, not laziness.
2. **The census engine structurally cannot express "must be zero."** `assertRule` raises a
   *structural* failure when a rule matches nothing anywhere — deliberately, and correctly
   ("a rule pinned at 0 is a gate that can never fail"). So no census rule can guard D1: I
   cannot write "`'unsafe-inline'` must appear zero times in `tauri.conf.json`." §9 routes
   that assertion to `check-tauri-configs.mjs` instead. This is a real limit of the shared
   mechanism and it is upstream of why D1 has gone unguarded.
3. **No signal distinguishes trusted from untrusted at the type level.** Every string is
   `string`. `escapeHtml(x)` and `x` have identical types, so nothing prevents the escaped and
   the raw value from being swapped in `SimulationPanel.tsx:69`. See §9's type answer.
4. **`freezePrototype: false`** in both configs. Prototype-pollution hardening is off. Not
   reachable from any surface measured here; noted because it is adjacent and one line to flip.
5. **The Android CSP is weaker than desktop.** `tauri.android.conf.json:11` has
   `script-src 'self' 'unsafe-eval'`. Still no `'unsafe-inline'`, so injected markup remains
   inert, but the mobile target does not inherit the desktop guarantee and no gate notices.

## Convergence — what the sibling repos say

**`../personas-web` (Next.js, renders user-submitted and CMS content) independently
reinvented `sanitizeExternalUrl` — same name, same job, with its own test file.**
`src/lib/url.ts` is 23 lines that parse the URL and accept only `http:`/`https:`;
`src/lib/url.test.ts` enumerates `javascript:`, `data:text/html,<script>`, `vbscript:`,
`mailto:`, relative, and empty. Its feature doc goes further than ours: *"Use it even when
today's URL is a hardcoded constant — it's the schema guard for any value that could later
come from a CMS/data/user input."* Two codebases, no shared document, same function name.
**The URL-scheme trust boundary is physics, not house style.** §2's URL clause is the most
portable thing in this document.

It also converges on the dSIH discipline from the opposite direction: 15 of its 16
`dangerouslySetInnerHTML` sites are JSON-LD `<script>` tags, and every one routes through
`safeJsonLd()` (`src/lib/seo.ts:48-52`), which neutralizes `</script` and `<!--`. Same
prescription as §2 step 4: *a named helper owns the escaping, the call site just names it.*

**Where convergence contradicts this document — and we should not follow it.**
`personas-web`'s version returns `"#"` on rejection; ours returns `null`. The sibling's
signature is `(value: string) => string`, which is *total*: it always yields a renderable
`href`, so a caller cannot fail to handle the reject case and cannot notice it either — a
blocked link renders as a live-looking dead one. Ours is `string | null`, and the `null`
forces the branch that `MarkdownRenderer.tsx:309` actually takes, degrading to a `<span>`.
**The more convergent shape is the weaker one.** This is the accessibility-floor lesson
repeating: two codebases agreeing is evidence about universality, not a licence to relax.
Convergence tells us the *boundary* is physics; it does not ratify the *return type*.

**`../brainiac/console`: no signal.** No `dangerouslySetInnerHTML`, no markdown or sanitizer
dependency, no URL-scheme guard. It renders no untrusted markup, so it neither confirms nor
contradicts. Reported as absence of evidence, not evidence of absence.

**Nothing in either sibling corresponds to §6's CSP finding or to the two-layer
`defaultUrlTransform` + repo-sanitizer stack.** Both are Tauri-specific and should be read as
local calibration for a desktop app with an exposed IPC bridge, not as portable doctrine.

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Partially yes — and the available type move is better than the gate it would replace.**

- **`img`/`a` in markdown: type, not gate.** The deviation in D5 exists because
  `MarkdownRenderer` *exposes* `src` to a component override that then forwards it. The fix
  is the `createLazySection` pattern from the contract: let the primitive own the dangerous
  parameter. If `MarkdownRenderer`'s own `img` override calls `sanitizeIconUrl(src)` and
  degrades on `null`, then **no consumer can render an unsanitized image**, and 49 call sites
  × 3 component maps collapse to one place. This removes the class permanently; a gate would
  only count it. Propose this as the fix.
- **`sanitizeExternalUrl`'s `string | null` is already the type doing this job** — keep it,
  and do not adopt the sibling's `string` (see Convergence).
- **`dangerouslySetInnerHTML`: gate, because no type is possible.** React declares this prop
  on every intrinsic element; nothing in userland can make it unrepresentable. It is a small
  (5), fully enumerable, high-severity population — exactly the case where a baseline pinned
  near zero is the right instrument rather than a ratchet.
- **The CSP: neither** — it is a JSON string, so it needs an assertion, not a type or a count.

### Signal 1 — census rule `raw-inner-html` (ships below)

**Condition it is a proxy for:** *a string reaches the DOM as markup rather than as a text
node.* An adopting repo on another stack should re-derive its own proxy for that condition
(`v-html`, `{@html}`, `innerHTML=`, `SafeHtml`), not port this pattern.

**Not already gated.** All 41 existing rules in `scripts/census/rules.json` were checked; none
covers HTML injection, sanitization, or URL schemes. `eslint.config.js` has no
`react/no-danger`.

Pinned at the current reality — 4 files, 5 matches — so any sixth occurrence fails
`npm run census:check`, which `npm run check` already runs. It is a **review trigger**, not a
migration ratchet: the correct response to a failure is usually to justify the new site
against §2 step 4, then `--update`.

```json
{"rules":[{"id":"raw-inner-html","goldenPath":"docs/concepts/golden-paths/rendering-untrusted-content.md","roots":["src"],"extensions":[".ts",".tsx"],"signal":{"pattern":"dangerouslySetInnerHTML","flags":"g","ignoreCommentLines":true,"description":"Every React escape-hatch into raw HTML. Proxy for: a string reaches the DOM as markup rather than as a text node. The population is small and fully enumerable (4 files), so this is pinned near zero as a review trigger, not a migration ratchet -- any new occurrence must be justified in review against the golden path."},"baseline":{"files":4,"matches":5},"floor":4000}]}
```

**Validation (run 2026-08-14 against `scripts/census/run-census.mjs --rules <file>`):**

| # | Scenario | Expected | Exit |
| --- | --- | --- | --- |
| Baseline | rule as shipped | `OK 4/4 files, 5/5 matches, 4829 walked` | **0** |
| **Positive control** | tree containing *only* the compliant form of the same component — sanitized value rendered as a text node, with the literal word `dangerouslySetInnerHTML` present in its JSDoc — baseline declared 1/1 | must **fail**: matcher must not fire on compliant code | **1** (`zero-matches`; the 1 comment hit was correctly ignored) |
| Negative control | one violation added to that same tree | `files rose 0 -> 1` | **1** |
| Fault: new violation | canary file added to the real `src/` | `files rose 4 -> 5` | **1** |
| Fault: silent drop | baseline claims 5/6 | `files dropped 5 -> 4 … a silent drop is a broken matcher` | **1** |
| Fault: broken matcher | `roots` narrowed to one directory | `walked 12 but floor is 4000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| Re-run | unchanged | baseline reproduces exactly | **0** |

The positive control is the one that matters: the compliant fixture **mentions the pattern in
prose and still does not match**, so the rule discriminates between doing the dangerous thing
and writing about it. `ignoreCommentLines` is load-bearing — it suppresses exactly 4 JSDoc
matches in `sanitizeHtml.ts` and `variableSanitizer.ts`, which are documentation *of this
doctrine*. Without it the gate would baseline its own docs.

### Signal 2 — a CSP assertion in `check-tauri-configs.mjs` (D1, not shippable as a census rule)

Census cannot host this: the healthy state is zero matches, which the engine treats as a
structural failure by design (§8 gap 2). The right host is
`scripts/check-tauri-configs.mjs`, which already parses all three config files and already
runs inside `npm run check`. It should assert, for `csp` and `devCsp` in every config
including `tauri.android.conf.json`:

- `script-src` is present and contains neither `'unsafe-inline'` nor `'unsafe-eval'`
  (Android's existing `'unsafe-eval'` is the one allowlisted exception, with a written reason);
- `object-src` is `'none'` and `base-uri` is `'self'`;
- `img-src`, `connect-src`, `frame-src` and `media-src` contain no bare `*` and no `http:`
  scheme wildcard.

**How it fails loudly if its own precondition is absent** — the requirement the contract
calls non-optional, and the one `ci.yml`'s museum of no-op gates keeps violating: the check
must **fail, not skip**, when `app.security.csp` is missing or is not a string. A CSP check
that silently passes on a config where someone deleted the `csp` key is worse than no check,
because it certifies the exact regression it exists to catch. It must also assert it examined
all three config files by name, and print the parsed directive list on success so a build log
distinguishes "CSP verified" from "CSP not found."

**Allowlist:** `tauri.android.conf.json`'s `script-src 'unsafe-eval'`, with a prose reason,
and nothing else.

---

### Verification of this document's own numbers

Every count above was measured at composition time, not estimated. The §9 rule block was
re-extracted from this finished file and re-run: **4 files, 5 matches, 4,829 files walked,
exit 0** — reproducing the baseline exactly. One finding was measured, published to my own
notes, and then **retracted before it reached this document**: an initial scan reported 4
anchors missing `rel="noopener"`, which was an artifact of grepping for `noopener` alone —
all 4 carry `rel="noreferrer"`, which implies it. The corrected number is **0 of 32**.
