# Model-composed UI

> **Leaf:** `ai-agents / model-output-rendering / model-composed-ui` · recurrence 46
> **Composed:** 2026-08-15 against `master` @ `2a874e692`
> **Sweep:** every model-output→UI surface in the tree, read individually: the 4 widget-composition
> ops and their 4 validators, the 3 markdown render paths, the 4 streaming paths, the SurfaceSpec
> grammar + renderer + its 2 consumers, `webbuild/plan.rs`, `applyClientAction`, the companion
> dispatcher's 54-verb action table and 9-verb read table, and all 15 hand-rolled model-JSON
> extractors across 963 Rust files. Tree-wide counts over 4,829 TS/TSX and 963 Rust files cite
> [`shared-facts.json`](../shared-facts.json) (commit `211d519bb`); the census numbers below were
> re-derived here by **two independent implementations that agree exactly**.
> **Four fixtures were executed, not read** — truncated model output was fed through the real
> renderers under Vitest/jsdom, and that is where three of this document's four sharpest findings
> came from. Sibling repos `../brainiac` and `../personas-web` were measured for convergence.

**Adjacent leaves — cross-reference, do not absorb.**
[`rendering-untrusted-content.md`](./rendering-untrusted-content.md) owns **safety**: sanitisation,
`dangerouslySetInnerHTML`, URL schemes, the CSP. It measured this tree clean — 5 `dSIH` sites, zero
unsanitised, `rehype-raw` absent, production `script-src` with no `'unsafe-inline'` — and that
clearance is a *precondition* of this path, not a topic of it. Where a model's string could become
markup, that path is authoritative. **This path owns what happens when the model decides the
_shape_**: which component renders, which action is offered, which id is targeted, and what the
screen does while only half the decision has arrived.
[`long-running-job-progress.md`](./long-running-job-progress.md) owns the *transport and liveness*
of a stream — that a turn is readable by a client that wasn't listening, and reaches a terminal
state if the worker dies. This path owns only what the growing string may look like on screen.
[`typed-error-contract.md`](./typed-error-contract.md) owns errors the app authors; a model's
malformed output is not an error, it is expected input.

---

## Headline: the failure the brief predicted is absent, and the defence against it is the defect

The commissioning brief asked me to expect this: *"Streamed markdown is half-parsed at every frame
— an unterminated code fence or table row must not throw or flash."* I fed **all 379 prefixes** of
a realistic Athena reply (a `<thinking>` block, prose, a fenced `tsx` block, a GFM table, two
trailing sentinel lines) through the real `MarkdownRenderer` under jsdom. Measured:

| Prefix-level behaviour over 379 truncations | Result |
| --- | --- |
| Renders that threw | **0** |
| Unterminated code fence rendered as prose | **0** |
| Half-written GFM table rendered as literal pipes | **0** |
| `<thinking>` reasoning visible to the user | **13 prefixes** |
| Raw `BUILD_PLAN:` / `NEEDS_INPUT:` protocol visible | **132 prefixes** |

`remark`/`remark-gfm` auto-close an open fence and an open table at end-of-input, so a partially
received markdown document is *always* a valid markdown document. **The predicted defect class does
not exist in this stack** — and a cleared claim is worth as much as a confirmed one.

What does exist is the mitigation written against it. `ChatMessageContent`'s `makeStreamSafe`
([`ChatMessageContent.tsx:24-42`](../../../src/features/agents/components/ChatMessageContent.tsx))
says it exists "so streaming output never renders a half-parsed block (which would flash as raw
markdown text)". I rendered every prefix of a code-bearing reply twice — `streaming` on and off —
and diffed the rendered text:

> **53 of 82 prefixes (65%) render LESS text with `streaming` on than with it off.** From the
> moment the fence opens (char 22) until the closing fence lands (char 74), the streaming path
> emits an **empty code block**: `content.slice(0, start) + '```\n```'` discards the partial body.
> The non-streaming path renders the same partial code correctly, inside a real `<code>` element,
> with its copy button.

So the guard blanks the code the user is watching being written, for the entire time it is being
written, to prevent a flash that this markdown stack cannot produce. **This is the finding that
came from running the fixture rather than reading it, and it inverts the brief's premise twice:
the hazard is absent and the defence is the harm.**

The real partial-input hazards are the two the brief did not name, and both are *marker*
problems rather than *grammar* problems: a meta-block whose regex needs its closing tag (§7 D5),
and a machine protocol split on a token that arrives one character at a time (§7 D6). Markdown
degrades gracefully under truncation. **Sentinels do not.**

Second headline, from the other end of the sweep: this repo has already built the best answer to
this leaf — `sanitize_briefing_spec` (§6) and the `SurfaceSpec` zod grammar (§3) — and applies it
to two of its five model-composed surfaces. The other three are where every deviation lives.

---

## Principle

*Three sentences, no repo path, no primitive name, no count — the layer a sibling repo on another
stack can adopt as-is. Each clause carries its warrant, per the
[portability test](../research/portability-test.md)'s finding that unmarked local calibration is
what gets a whole document discarded.*

> **(physics)** Everything a model may name — a component, an action, a route, an id — comes from a
> set the program declares, and a name outside that set is rejected at the boundary, never at the
> render. **(physics)** Getting a typed value out of model output is one function, not one per call
> site, because each copy silently disagrees about what the model actually emits. **(ergonomics)**
> A partially-arrived reply is rendered only through a grammar that is total over prefixes; where a
> machine marker exists, either the whole marker has arrived or none of the surface has.
>
> *Directional corollary (ergonomics, contested — see Convergence):* an unknown **component** fails
> visibly and names itself; an unknown **action** is dropped silently. Both repos measured agree the
> set must be closed; they disagree on what an unknown value does, and the risk direction is what
> resolves it.
>
> *Scale condition:* the second clause starts paying at the second parser. Below that, one inline
> brace scan is honest.
> *Local calibration (do not port):* everything below this block.

---

## 1. Trigger

You are in this situation when any of these is true:

- "Athena/the persona should show this as a *card* / *panel* / *dashboard*, not a paragraph."
- "Let the model pick which widget / which tab / which persona to act on."
- "Parse the JSON the model returns into `T`."
- "Stream the reply into the bubble as it arrives" / "why does the code block go blank while it types?"
- "The model emitted a kind we don't have" / "it hallucinated an id."
- "Strip the `OP:` / `BUILD_PLAN:` / `<thinking>` lines before showing it."
- **The "about to write X" test:** you are about to type `JSON.parse(reply)`, `serde_json::from_str(&assistant_text)`,
  `blob[..pos].rfind('{')`, `registry[model.kind]`, `content.split('SOME_MARKER:')`,
  `Record<string, ComponentType>`, or a new `"kind": "a|b|c"` alternation inside a prompt string.

If the question is *"could this string become markup"* → [`rendering-untrusted-content.md`](./rendering-untrusted-content.md).
If it is *"is the job still alive"* → [`long-running-job-progress.md`](./long-running-job-progress.md).

## 2. The one way

**Give the model a vocabulary, validate the reply against that vocabulary at the boundary that
receives it, and render only what survived.** The vocabulary is a schema, not a prose list: a zod
discriminated union on the frontend (`SurfaceSpec`) or an explicit `&[&str]` plus a per-field check
on the backend (`sanitize_briefing_spec`), and the set of block/widget/action names must be derived
from the code that renders them, never re-typed into a prompt. Validate **per item, not per
document** — drop the hallucinated block and keep the sound ones, report how many you dropped, and
fall back to plain markdown only when nothing survives. Every id the model names is checked against
the closed set of ids the model was actually shown, and re-checked at the render boundary because
the spec is persisted and outlives the turn that produced it. To get JSON out of prose, call the
one shared extractor (`safe_json::extract_balanced_object` / `athena_reaction::extract_json_envelope`);
never write the brace scan again. While a reply is still arriving, render it through markdown —
which is total over prefixes — and render **nothing at all** through a machine marker until that
marker has fully arrived; if that is hard, do what the Athena chat did and don't render live tokens.
And when you must, budget the re-parse: rAF-driven, word-boundary-snapped, with past turns memoised.

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `features/shared/components/surface/surfaceSpec#surfaceSpecSchema` | The frozen agent-UI vocabulary: a zod discriminated union of **7 block types**, each mapping onto one blessed catalog component. Coerces (`3` → `"3"`), truncates (labels ≤ 48, markdown ≤ 60 000), clamps (gauges to 0–100), caps (≤ 12 blocks, ≤ 200 rows, ≤ 50 decisions, ≤ 3 actions). |
| `…/surfaceSpec#parseSurfaceSpec` | Strict parse, then a **salvage pass**: individually-invalid blocks are dropped and *counted* (`dropped: number`); fails only when nothing renderable survives. |
| `…/surfaceSpec#extractSurfaceSpec` | Finds a spec in raw run output in the three shapes the pipeline actually produces — whole JSON, nested under `"surface"`, or one NDJSON line. Returns `null` so the caller degrades to markdown. |
| `…/surface/SurfaceRenderer` | Renders a parsed spec. Its block `switch` is **total by construction** — the `default:` arm is a `never` guard ([`SurfaceRenderer.tsx:272-278`](../../../src/features/shared/components/surface/SurfaceRenderer.tsx)) — and every action is consent-gated through `DispatchChooser` / `ConfirmDialog`. |
| `home/sub_cockpit/widgetRegistry#cockpitWidgetRegistry` | The 29-kind widget map Athena composes against. Both consumers render a **visible, translated error tile naming the unknown kind**. |
| `home/sub_cockpit/briefing/actionTypes#parseWidgetActions` | Re-validates a persisted spec's `actions` at render: unknown kinds, missing targets and non-objects are dropped; capped at `MAX_WIDGET_ACTIONS = 3`. **Measured: never throws on 7 hostile inputs.** |
| `companion/brain/briefing#sanitize_briefing_spec` (Rust) | The reference validator: closed widget set, closed action set, an action×widget legality matrix, **ids checked against the delta document the model was shown**, caps, span clamp, id backfill, and an error when nothing survives. |
| `companion/athena_reaction#extract_json_envelope<T>` (Rust) | The generic "pull the object containing this key out of prose" loop. String- and escape-aware via `match_braces`. **This is the destination §9 ratchets toward.** |
| `engine::safe_json#extract_balanced_object` / `#parse_lenient_json` (Rust) | The canonical forward brace matcher (string-aware, unlike a naive `find`/`rfind`) and the "try strict, then extract, then fail loudly with the first 300 chars" wrapper. |
| `companion/brain/oneshot#extract_json_span` (Rust) | The labelled span extractor used by the 6 one-shot brain calls; its error names *which* call produced the unparseable reply. |
| `webbuild/plan#extract_build_turn` (Rust) | The reference sentinel parser: line-anchored `strip_prefix`, **markers stripped whether or not they parsed**, and a hallucinated `area` filtered down to `top\|middle\|bottom`. |
| `stores/slices/system/tourSlice#isSafeTourTestId` | The trust boundary for a model-supplied **CSS selector**: `^[a-zA-Z0-9_-]+$`, enforced at the slice setter so no call site has to remember. |
| `features/studio/StudioMessages#useTypewriter` | The only budgeted stream renderer: rAF-driven, `COMMIT_MS = 45` (≈22 re-parses/s, not 60), snapped back to the last word boundary so a half-typed token is never parsed. Pair it with `memo` on past turns. |
| `plugins/companion/chat/athenaChatDeltas#useAthenaChatDeltas` | Per-conversation token coalescing: N `text_delta` events become **one** store write per animation frame. |

**Do not reach for `safeJsonParse`** (`lib/utils/parseJson.ts`) for model output. It is `JSON.parse`
that returns a tuple instead of throwing — see §7 D7 for the measurement.

## 4. Steps

1. **Ask whether the model needs to compose UI at all.** Prose through `MarkdownRenderer` is the
   default and needs none of this. Composition earns its cost when the answer has *structure the
   user will act on* — a comparison, a decision with buttons, a table.
2. **Pick the existing vocabulary before inventing one.** `SurfaceSpec` (7 blocks, consent-gated
   actions, persisted-safe) covers most cases and already has a prompt-authoring doc at
   [`surface/SPEC.md`](../../../src/features/shared/components/surface/SPEC.md). A new op needs a
   new vocabulary only when it composes a *layout* (the cockpit grid) rather than a *document*.
3. **Declare the set in code, then derive the prompt from it.** The registry keys, the `&[&str]`
   allowlist and the `kind: "a|b|c"` string inside the prompt must have exactly one author. Today
   they have four (§8 Gap 1), and one has already drifted to zero overlap (§7 D1).
4. **Validate at the boundary that receives the model's bytes.** Per item, keep-what-survives, and
   return a `dropped` count the UI can show honestly. `parseSurfaceSpec` and `sanitize_briefing_spec`
   are the two shapes to copy.
5. **Check every model-named id against the set the model was shown.** `sanitize_briefing_spec`
   builds `persona_ids` / `pausable_ids` / `approval_ids` from the same delta document it put in the
   prompt, so a hallucinated id cannot survive. An id that only passed a `typeof === 'string'` check
   has not been validated.
6. **Re-validate on render.** A composed spec is persisted; the row outlives the turn, the app
   version, and the id it targeted. `CockpitPanel.tsx:451-453` re-parses the actions of a spec
   written weeks ago, with the comment *"never trust a stored/composed spec's raw shape"*. Copy that.
7. **Decide the unknown-value policy by risk direction, and write it down.** A component you cannot
   render → **visible error naming the kind** (the user must know the answer is incomplete). An
   action you cannot authorise → **silent drop** (naming it invites the user to ask for it). A read
   you cannot serve → **say so**, never answer a different question (§7 D8).
8. **For JSON in prose, call the extractor. And then stop.** `extract_json_envelope::<T>(blob, marker)`
   when a key anchors the object; `safe_json::parse_lenient_json::<T>(raw)` when the whole reply
   should be the object. Do not write `rfind('{')`.
9. **For a streaming surface, choose one of two postures and commit.** Either render live tokens
   through markdown with a budgeted typewriter (`useTypewriter`) and accept that markers will be
   partially visible — or do not render live tokens at all and show a beat, which is what
   `AthenaChatStreamingTurn.tsx:86-92` chose, *citing this exact leakage*. Do not choose "render
   live tokens and defend with a string transform": that is D2.
10. **Before writing a gate, ask the contract's prior question — can the signature make the wrong
    call impossible?** For block/widget kinds the answer is yes and it is one type edit (§9). For
    the brace scan the answer is no. Answer it explicitly.

## 5. Anti-patterns

- **`Record<string, ComponentType>` for a model-chosen kind.** The `string` key is precisely what
  lets the prompt and the registry drift apart with no compile error, and it is the root cause of
  the 0-of-9 vocabulary in D1. The failure mode is not a crash — it is a feature that silently
  stops existing while every layer reports success.
- **Re-typing the vocabulary into a prompt string.** `constitution.md` spells four widget
  vocabularies as `|`-alternations inside a JSON example. Nothing compares them to the code. One
  has been wrong for long enough that the render target was deleted underneath it.
- **Validating the envelope but not the items.** `compose_cockpit` checks `widgets` is a non-empty
  array and forwards it; `compose_dashboard` does the same. "It's an array" is not validation — it
  moves the hallucinated kind from a place that could report it to a place that can only render a
  red box.
- **A closed set spelled twice, in two languages, by hand.** `ClientAction::OpenCompanionTab` is
  produced in Rust and validated against `VALID_COMPANION_TABS` in TypeScript. They disagree, and
  the disagreement is a bare `return` (D1).
- **Treating an id as validated because it is a non-empty string.** `asNonEmptyString(a.personaId)`
  proves the model typed *something*. Only membership in the id set the model was shown proves it
  typed a real one.
- **Defending a streamed markdown document with a string transform.** Markdown is already total
  over prefixes; a transform that "makes it safe" can only remove content that would have rendered
  fine. Measured cost of the one in this tree: 65% of a code block's streaming lifetime (D2).
- **Splitting a stream on a machine marker.** `stream.split('BUILD_PLAN:')` matches the marker
  anywhere — inside prose, inside a fence — and matches nothing while the marker is half-arrived,
  so it both truncates too much and too late. Anchor markers to line starts, and strip them where
  the whole reply is in hand.
- **A meta-block regex that requires its closing tag.** `<thinking>[\s\S]*?<\/thinking>` removes
  nothing until `</thinking>` lands, so the model's private reasoning is on screen for the entire
  duration of the block. If you strip meta while streaming, strip from an *unmatched opening tag*
  to end-of-input too.
- **A fallback arm that answers a different question.** `_ => list_teams(db, query)` is worse than
  an error: the model asked X, the user reads an answer to Y, and no layer records that the verb
  was never recognised.
- **`JSON.parse` on model output, with or without a try/catch.** Measured: **0 of 6** realistic
  almost-JSON shapes recover — a fenced block, a prose preamble, a trailing comma, single quotes, a
  truncation, an empty string. A parser that cannot read a fenced ```json block has not met an LLM.
- **An empty typed shape that is indistinguishable from a refusal.** `brainiac` hit this and fixed
  it explicitly (`extract.rs:410`): it *requires* the `memories` key to be present so a
  `{"refusal": "…"}` wrapper cannot deserialize into an empty vec and report a clean zero-result.
  Any `#[serde(default)] Vec<T>` on a model envelope has this bug latent.

## 6. Evidence

**The one site to copy: [`src-tauri/src/companion/brain/briefing.rs:232-340`](../../../src-tauri/src/companion/brain/briefing.rs) — `sanitize_briefing_spec`.**

It is the only place in the tree that does all five jobs, and it does them in ~100 lines:

```rust
let persona_ids:  Vec<&str> = delta.failed_personas.iter().map(|p| p.id.as_str()).collect();
let pausable_ids: Vec<&str> = delta.failed_personas.iter().filter(|p| p.enabled)…;
let approval_ids: Vec<&str> = delta.pending_approvals.iter().map(|a| a.id.as_str()).collect();
…
if !BRIEFING_WIDGET_KINDS.contains(&kind) { continue; }                 // closed component set
if !ACTION_KINDS.contains(&a_kind) || !action_allowed_on(&kind, a_kind) { continue; }  // ×matrix
"rerun_persona" => a.get("personaId").and_then(|v| v.as_str())
                    .is_some_and(|id| persona_ids.contains(&id)),      // closed ID set
```

The load-bearing idea is in its doc comment: *"everything the composer may reference — and
everything an action may target — is inside this doc."* **The prompt and the validator read the
same document**, so the closed id set is not maintained — it is derived. `pausable_ids` goes
further and drops a pause action against an already-paused persona: the set is not just "real ids"
but "ids on which this verb is meaningful."

Its partner is the second half of the same discipline:
[`src/features/home/sub_cockpit/briefing/actionTypes.ts:36-62`](../../../src/features/home/sub_cockpit/briefing/actionTypes.ts)
— `parseWidgetActions` re-validates the *persisted* spec at render, because the row outlives the
turn. `CockpitPanel.tsx:451-453` calls it with the comment *"re-parsed here — never trust a
stored/composed spec's raw shape"*. **Validate at the producer, re-verify at the renderer** — and
`brainiac` reinvented exactly this pair for a different payload (§Convergence).

Supporting sites, each the best instance of one clause:

- [`src/features/shared/components/surface/surfaceSpec.ts:171-266`](../../../src/features/shared/components/surface/surfaceSpec.ts) —
  the vocabulary as a **type**. The discriminated union makes an unknown block unrepresentable in
  the parsed value, which is why `SurfaceRenderer`'s `switch` can end in `const _never: never = block`.
  The salvage pass drops bad blocks and returns `dropped`, which `SurfaceRenderer.tsx:122-126`
  renders as an honest "N blocks left out" note.
- [`src-tauri/src/webbuild/plan.rs:64-125`](../../../src-tauri/src/webbuild/plan.rs) — the sentinel
  parser. Two properties worth copying: markers are stripped **whether or not the payload parsed**
  (`continue; // strip either way — never surface raw JSON`), and a model-supplied `area` is filtered
  to `matches!(a, "top"|"middle"|"bottom")` — a free-text field narrowed to a closed set at the
  boundary. Its deliberate *non*-closure is documented too: `status` stays a `String` "so a
  hallucinated value degrades gracefully rather than failing the whole parse" (see D10 for the half
  of that contract the renderer doesn't keep).
- [`src-tauri/src/companion/dispatcher.rs:2407-2412`](../../../src-tauri/src/companion/dispatcher.rs) —
  the best unknown-verb handling in the tree: an action outside the **54**-entry `ALLOWED_ACTIONS`
  pushes `"rejected unknown action \`{}\`"` into a warnings list that lands in *the next turn's system
  context*. The model is told it was wrong, in a channel it will read. Compare `:1516-1548`, where
  `explain_in_cockpit` drops unknown widget kinds with a per-kind warning **and explains why it does
  this and `compose_cockpit` does not** — a documented deviation is still a deviation, but it is an
  honest one.
- [`src-tauri/src/companion/dispatcher.rs:693-707`](../../../src-tauri/src/companion/dispatcher.rs) —
  `repair_op_json`: appends only the missing closing braces, only when the line does not end inside a
  string literal, and keeps the original parse error when unrepairable. *"A syntactic completion,
  never a semantic guess."* Grounded in a dated live incident (an 1,100-char `dev_improve` op missing
  its final brace, where the prose claimed a dispatch that never happened). This is the correct shape
  for tolerance: bounded, syntactic, and it fails loudly rather than inventing.
- [`src/stores/slices/system/tourSlice.ts:176-195`](../../../src/stores/slices/system/tourSlice.ts) —
  a model-supplied string that becomes a **CSS selector**, guarded by `^[a-zA-Z0-9_-]+$` at the slice
  setter, with the reasoning written out: an id containing a quote crashes `querySelector` and kills
  the spotlight for the rest of the session. `dynamicTours.ts:44-48` goes further and checks the
  anchor against a *generated* manifest, and `:199-200` simply **discards** the model's chosen `icon`
  and `color` and hardcodes them — the cheapest closed set is an empty one.
- [`src/features/studio/StudioMessages.tsx:16-57`](../../../src/features/studio/StudioMessages.tsx) —
  the streaming cost budget, with its own measurement in the comment: *"every commit re-parses the
  partial text through ReactMarkdown … by far the most expensive thing in a streaming turn"*, hence
  rAF (no work while hidden), `COMMIT_MS = 45` (≈20/s not 60/s), and a word-boundary snap so a
  half-typed token is never parsed. Line 61 memoises past turns, "without this memo each commit
  re-parsed the markdown of *every* earlier message too."
- [`src/features/plugins/companion/chat/AthenaChatStreamingTurn.tsx:86-92`](../../../src/features/plugins/companion/chat/AthenaChatStreamingTurn.tsx) —
  the other legitimate posture, stated as a decision: *"We deliberately do NOT render the live token
  stream: the token-by-token prose reflowed constantly and leaked Athena's machine grammar
  (OP:/QR:/TTS: directives) before the server-side strip."* Two surfaces, two postures, both
  defensible; what is not defensible is the third option in D2.

### Measured properties of the primitives (executed, not read)

| Probe | Result |
| --- | --- |
| `MarkdownRenderer` over 379 truncations of a code+table+thinking reply | 0 throws; 0 fences as prose; 0 tables as pipes |
| `parseWidgetActions` over 7 hostile inputs (`null`, a string, unknown kind, missing target, 4 actions, a `{toString}` id, `[42, undefined, [], {kind:null}]`) | never throws; returns `[]` for 6, and `['rerun_persona','pause_persona','approve_approval']` for the over-cap case — correctly capped at 3 |
| `cockpitWidgetRegistry['stat_grid_v2']` | `undefined` → the visible error tile |
| `safeJsonParse` over 6 realistic almost-JSON model replies | **0 recovered** (see D7) |
| `MarkdownRenderer` re-render cost, 40 frames over a 1,137-char reply | 13,110 `String.prototype.replace` calls ≈ **328 per frame** |

## 7. Deviations

**D1 — `compose_dashboard` is a live, prompted, auto-firing op whose entire vocabulary is
unrenderable and whose destination was deleted. Four layers fail independently; every one is
silent. (P1)**

| Layer | State |
| --- | --- |
| Prompt | [`constitution.md:293`](../../../src-tauri/src/companion/templates/constitution.md) teaches 9 kinds: `kpi_tile\|executions_status_chart\|cost_per_day_chart\|top_personas_list\|latency_distribution_chart\|success_rate_gauge\|persona_cost_donut\|activity_heatmap\|recent_executions_table` |
| Renderer | **0 of those 9** exist in `cockpitWidgetRegistry`'s 29 kinds (measured) |
| Dispatcher | `dispatcher.rs:718-736` auto-fires on "is `widgets` a non-empty array" and nothing else |
| Executor | `approval_exec_core.rs:1013` returns `ClientAction::OpenCompanionTab { tab: "dashboard" }` |
| Client | `applyClientAction.ts:33` — `VALID_COMPANION_TABS = ['setup','memory','voice','decisions']` → `"dashboard"` fails the check → **bare `return`** |
| Page | `CompanionPluginPage.tsx:23` — *"The former Dashboard tab was retired — Cockpit is the dynamic dashboard surface now."* |
| Reader | `companion_get_dashboard` still registered at `lib.rs:2942`; its wrapper `companionGetDashboard` (`api/companion.ts:1614`) has **0 call sites** |

The user sees `"Dashboard composition saved with N widget(s) — opening it for you now."` and nothing
opens. The spec is written to `dashboard.md` on disk and to a `companion_node` row on every
composition. Fix: delete the op, its prompt block, its executor arm, `CompanionDashboardWidgetKind`
(which documents a `widgetRegistry` in a `sub_dashboard/` directory that does not exist), and the
dead command — or point it at the cockpit registry. **Not a UI bug: a whole capability that
evaporated with four green layers behind it.**

**D2 — `makeStreamSafe` blanks the code block it exists to protect, for 65% of its streaming
lifetime. (P1)** [`ChatMessageContent.tsx:28-42`](../../../src/features/agents/components/ChatMessageContent.tsx),
applied at `:138` when `streaming`. Measured over all 82 prefixes of a fenced reply: 53 render less
text than the unguarded path; the drop window is chars 22→74, i.e. fence-open to fence-close.
Root cause is one line — `content.slice(0, start) + '```\n```'` throws the partial body away — and
the special case at `:37` proves the author saw the problem for a *leading* fence and fixed only
that instance. Fix: delete the function (its stated premise measured false, 0/379) or, if a
placeholder is genuinely wanted, append `\n``` ` in every branch instead of slicing.

**D3 — 14 hand-rolled copies of a generic that exists. (P2, and the §9 ratchet.)**
`athena_reaction::extract_json_envelope::<T>(blob, marker)` (`athena_reaction.rs:855-874`) *is* the
12-line "find the marker, walk back to `{`, brace-match forward, deserialize" loop, generic over the
envelope type. **2 call sites use it** (`kpi_binding.rs:383`, `kpi_derivation.rs:193`). The loop is
written out again, verbatim except for the marker and the type, at **15 sites in 9 files** (one of
which is the primitive itself):

| File | Sites |
| --- | --- |
| `src-tauri/src/companion/athena_reaction.rs` | `:659`, `:682`, `:1504` (+ `:864`, the primitive) |
| `src-tauri/src/engine/deliberation.rs` | `:473`, `:1239`, `:1552`, `:1669` |
| `src-tauri/src/companion/proactive/{message_triage,execution_review,backlog_triage}.rs` | `:182`, `:458`, `:221` |
| `src-tauri/src/companion/brain/profile_synthesis.rs` | `:316` |
| `src-tauri/src/engine/build_session/{runner,fix_pass,fanout}.rs` | `:191`, `:390`, `:439` |

One copy is **wrong**: `fanout.rs:440-455` brace-matches with `'{' => depth += 1` and no
`in_string` state, so a `}` inside any model-authored string value closes the object early, the
slice fails to parse, and the fallback returns `None` with no record. Every other copy — and
`safe_json::extract_balanced_object`, whose doc comment says string-awareness is the entire point —
is escape-aware. This is the concrete cost of the 14 copies, and it is not hypothetical: the
payload here is `persona_wide`, a blob of model-authored prompt text.

**D4 — `compose_cockpit` validates no widget kind, and the code says so. (P2)**
`dispatcher.rs:1492-1512` checks only that `widgets` is a non-empty array. Its sibling at `:1514`
opens with *"Unlike `compose_cockpit`, widget kinds are validated here: an explanation with a
hallucinated kind renders as an error box at the worst possible moment."* Both reach the same
registry; only one filters. Result: a hallucinated kind in a composed cockpit becomes a permanent
red tile in a **persisted** surface — `save_cockpit_preserving_pinned` keeps it across sessions.
Fix: hoist `EXPLAIN_KINDS` to a shared const covering both arms, or better, §9's type answer.

**D5 — `<thinking>` and `[META]` leak for the whole time they are being written. (P2)**
`MarkdownRenderer.filterMetaContent` ([`:185-201`](../../../src/features/shared/components/editors/MarkdownRenderer.tsx))
matches `<thinking>[\s\S]*?<\/thinking>`, which removes nothing until the closing tag arrives.
Measured on a one-line thinking block: visible for 13 of 379 prefixes — the entire interval between
the reasoning being complete and `</thinking>` landing. The window scales with the block's length,
and react-markdown drops the raw tags while keeping the text, so it reads as ordinary prose. Live on
any surface that streams through `MarkdownRenderer`; today that is the Studio
(`StudioMessages.tsx:166` → `MessageBody` → `MarkdownRenderer`). Fix: also strip from an unmatched
opening `<thinking>` to end-of-input.

**D6 — the Studio's stream strip is a second, weaker implementation of `extract_build_turn`. (P2)**
`StudioMessages.tsx:123` — `rt.stream.split('BUILD_PLAN:')[0]?.split('NEEDS_INPUT:')[0]`. Two
divergences from the Rust parser it shadows:

- *Too late*: measured 5 of 379 prefixes render a partial marker (`BUILD_`, `BUILD_P`, `BUILD_PL`, …)
  before the split can fire. With rAF coalescing that is 1–2 visible frames of machine grammar.
- *Too eager*: `split` matches the marker **anywhere**, while `plan.rs:82` uses a line-anchored
  `strip_prefix`. A reply that mentions "the `BUILD_PLAN:` line" in prose, or inside a fence, has
  everything after it hidden for the rest of the stream and then restored when the cleaned reply
  lands — a visible truncate-then-reappear.

Fix: strip on line starts, and only for lines that are complete (i.e. followed by a `\n`).

**D7 — the repo's two "safe model JSON" primitives are respectively inadequate and unused. (P2 —
and the tenth instance of this wave's most repeated finding.)**

- `lib/utils/parseJson#safeJsonParse` returns `[data, error]` instead of throwing. Measured against
  6 realistic model outputs — `{"a":1,}`, `{'a':1}`, a fenced ```json block, `Sure! Here is the
  JSON: {...}`, `{"a":1`, `""` — it recovered **0**. It is `JSON.parse` with a different signature,
  not a model-output parser, and outside its own module it is referenced in exactly **1** file
  (`lib/types/types.ts`).
- `src-tauri/engine/src/safe_json.rs:175,191` — `lenient_from_str` / `lenient_from_str_as` **are** a
  real recovery pipeline: fence stripping, prefix/suffix chatter, trailing commas, and truncated
  keywords (`tru` → `true`), with **16 dedicated passing tests**. They carry
  `#[allow(dead_code)] // planned API — no Tauri command wires into lenient parsing yet`, and a
  tree-wide search finds **0 call sites outside the defining file**.

So the tree contains a fully-built, fully-tested answer to "the model returned almost-JSON" that
nothing calls, while 15 call sites hand-roll a weaker one (D3). This joins `ProcessContext` (0
production call sites), `useRovingTabIndex` (0), `require_valid_id` (0) and `SecureString` (2 of 15)
— **the tenth instance in this campaign of a primitive built for a leaf and then not adopted.** The
pattern is now frequent enough to be a finding about the repo rather than about any one primitive:
*the cost of building the right abstraction here is reliably paid, and the cost of routing callers to
it reliably is not.*

**D8 — an unrecognised read verb silently answers a different question. (P2)**
`dispatcher.rs:2396` — the `READ_OPS` match ends `_ => list_teams(db, query)`. The model asks
`describe_whatever`, the user is shown a team list, and no warning is recorded anywhere. Its own
sibling arm 12 lines later does this correctly (`"rejected unknown action \`{}\`"` into the next
turn's context). Fix: `_ => format!("\`{action}\` is not a read I can run.")` plus a warning.

**D9 — model-supplied ids become React keys and DOM test ids with no uniqueness check.**
`SurfaceRenderer.tsx:207` (`key={item.id}`) and `:216` (`testId={\`surface-decision-${item.id}\`}`).
`surfaceSpec` caps the id at 64 chars but never checks distinctness, and a `decisions` block may
carry 50 items. A model that repeats an id produces duplicate React keys (reconciliation bugs on
re-render) and duplicate test ids (the live-UI harness targets the wrong row). Fix: de-duplicate in
the salvage pass, keeping first-wins and counting the drops.

**D10 — the "degrade gracefully" contract on `WebBuildPhase.status` is only half-kept.**
`plan.rs:12` keeps `status` a `String` on purpose. But the renderer
(`StudioChecklistStepper.tsx:36-54`) is a chain of `=== 'done'` / `=== 'active'` / `=== 'pending'`
with **no final else**, so `"in_progress"` renders as an unlabelled dot with full-opacity text —
indistinguishable from nothing in particular. And `phaseProgress` (`studioBuildModel.ts:22-27`)
counts it as neither done nor active, so the progress figure quietly under-reports. Deliberate
openness needs an explicit "unknown" presentation, not a fall-through.

**D11 — `filterMetaContent` writes to error telemetry from a render function.** When a reply is
JSON-shaped, `MarkdownRenderer.tsx:193-197` attempts `JSON.parse` on the whole document and routes
the failure to `silentCatch`, which emits a `log.warn`, a Sentry breadcrumb **and** a
`recordSwallow` rollup. Measured on a 66-char JSON reply: the predicate fires at 4 prefixes and
fails at 3. On a streaming surface this is telemetry noise generated at the typewriter's commit
rate, describing nothing wrong. Fix: this parse is a formatting nicety — swallow it with a comment,
not with the swallow-telemetry pipeline.

## 8. Gaps

1. **Nothing links a prompt to the registry it describes, and this is upstream of D1 and D4.** The
   widget vocabulary is authored in **four** places, in two languages: `constitution.md`'s
   `|`-alternations (4 separate lists), `EXPLAIN_KINDS` (9, Rust), `BRIEFING_WIDGET_KINDS` (5,
   Rust), and `cockpitWidgetRegistry` (29, TS). Measured overlap with the registry today: cockpit
   12/12 ✓, explain 9/9 ✓, briefing 5/5 ✓, **dashboard 0/9 ✗**. Three are correct by luck and
   diligence; one has been wrong long enough for its render target to be deleted. There is no
   codegen step, no test, and no type that could have noticed. This is a genuinely unbuilt
   mechanism, not laziness — the prompt is a Rust string literal and the registry is a TS module.
2. **`extract_json_envelope` cannot serve the three `build_session` call sites, and the missing
   variant already exists as a fourth copy.** Those three need "the object containing this key,
   *if it has finished arriving*" — `runner.rs:188-215`'s `extract_early_behavior_core` scans a
   growing delta buffer and returns `None` until the braces balance, which is exactly the
   partial-tolerant semantic the shared primitive lacks. The fix is to lift that function's body
   into `safe_json` as `extract_balanced_object_from(buf, key) -> Option<&str>` and let all three
   plus the streaming case share it. Until then the §9 ratchet points at a destination that does
   not fit 3 of its 14 targets, which the contract explicitly warns about.
3. **No type distinguishes model-authored text from repo-authored text.** Everything is `string` /
   `String`, so nothing prevents an unvalidated reply from being passed where a validated one is
   expected. A `newtype ModelText(String)` on the Rust side, or a branded type in TS, would make
   "which of these two strings came from the model" checkable. Genuinely unbuilt.
4. **The census engine structurally cannot express "must be zero."** `assertRule` raises a
   *structural* failure when a rule matches nothing (correctly — "a rule pinned at 0 is a gate that
   can never fail"), so no census rule can assert *"no prompt lists a kind the registry lacks."*
   Gap 1's gate has to be a check script. Independently derived here and in
   [`rendering-untrusted-content.md`](./rendering-untrusted-content.md) §8 gap 2 — two paths hitting
   the same wall from opposite directions is evidence the limit is real.
5. **No test feeds a truncated document to `extractSurfaceSpec`.** `surfaceSpec.test.ts` covers a
   hallucinated block type, wrong version, over-cap, NDJSON, and decoys — but every input is
   well-formed or plainly non-JSON. The one shape a persona run actually produces on a cap-out
   (`{"surface":"v1","blocks":[{"type":"tab`) is untested. Cheap to add; it belongs with D3's fix.
6. **`useTypewriter`'s budget is not shared.** It is a 30-line local function in `StudioMessages.tsx`,
   so the next streaming surface will either re-derive it or (more likely) render every token.

## Convergence — what the sibling repos say

**The strongest signal: the closed-set-plus-visible-rejection discipline was reinvented four times
in `brainiac` with no shared code, and once more here.** Its MCP dispatch (`mcp.rs:725-745`, 18
tools) ends `other => Err(RpcError::new(-32602, format!("unknown tool: {other}")))`; its scope gate
(`mcp.rs:232-250`) ends `_ => "admin"` *"so a future tool cannot slip in ungated by accident"*; its
enum args reject with `-32602` under an explicit written contract — *"a malformed one is
InvalidParams per the hardening contract, never a silent no-op"*; and its UI narrowing
(`facets.ts:24-30`) coerces an unknown policy to `needs_review`, **never** `auto_published`.
Same mechanic, four hand-written instances, one repo. **The closed set is physics.**

**And the fix converges as well as the defect, which is the test that matters.** `brainiac` has
`extract_json_object` — a depth-counting brace scanner (`extract.rs:310`) shared by **4 of its 5**
model-JSON call sites — and one straggler at `faithfulness.rs:133` that reimplements it as
`find('{')` + `rfind('}')`, a weaker algorithm, ~200 lines away in the same crate, while a third
site's comment says *"Reuse the extractor's tolerant JSON recovery."* That is D3 exactly: the same
defect, the same shared destination, the same partial adoption, in a different language and a
different domain. The brief's earned lesson — *a defect that converges while the fix does not is
the signature of a spec-only requirement* — resolves the other way here: **both halves converge, so
§2's "one extractor" clause is doctrine, not a wish.** (Adoption: brainiac 4/5; personas 2/16.)

**The validate-at-the-producer, re-verify-at-the-renderer pair was reinvented for a different
payload.** `brainiac`'s "citation firewall" strips model-invented `[m:<uuid>]` ids server-side
(`compose.rs:274-321` — *"leaving it would make an unbacked claim LOOK sourced, which is worse"*)
and blocks auto-publish when uncited prose survives; then `markdown.ts:258-261` **recomputes the
same invariant client-side** and `DocReader.tsx:426-451` renders a visible "read with care" banner.
Two hand-written implementations of one rule, at both ends of the pipe — structurally identical to
`sanitize_briefing_spec` + `parseWidgetActions`. §4 step 6 is portable.

**Where convergence contradicts this document, and how it resolves.** The two siblings land on
*opposite* answers to "what does an unknown value do." brainiac never lets an unrecognised value be
invisible; `personas-web`'s guide block registry (`parseCustomBlock.tsx:20-38`, 13 block types)
returns `null` — a misspelled type renders **nothing at all**, no error, no log. This repo does
both, and I initially read that as inconsistency. It is not: `CockpitPanel` shows a visible error
for an unknown *component* and `parseWidgetActions` silently drops an unknown *action*, and the
split is by risk direction — naming an action you refused to offer invites the user to ask for it,
while hiding a component you could not render makes the answer silently incomplete. **Convergence
tells us the set must be closed; it does not settle the rejection policy, and the risk direction
does.** That is the honest reading, and §Principle records it as contested rather than as physics.

**Where convergence is absent — and what that costs this document.** *There is no token-streaming
render path in either sibling.* Zero `text_delta`, zero accumulate-and-render, zero partial-document
rendering; brainiac's `ChatRequest` (`gateway/src/lib.rs:41-53`) has no `stream` field at all, and
`personas-web`'s SSE (`useEventStream.ts:119`) carries whole JSON records, not deltas. **Neither
repo coalesces anything** — no rAF batching, no throttle, on any output path. So §2's streaming
clauses and every primitive in §3's bottom three rows have **no external corroboration**. Per the
contract, mark them as **house convention, not doctrine**: they are the right answer for this app,
and an adopting repo should re-derive rather than inherit them. The two rAF coalescers in this repo
(`athenaChatDeltas.ts:47-57`, `studioStore.ts:171-175`) do converge with each other — but intra-repo
convergence is much weaker evidence, since both authors could read each other's code.

**A correction to an earlier composer's claim about `brainiac`.** `meter_op`
(`gateway/src/providers/mod.rs:128-154`) was reported as covering the LLM boundary *totally*. It
covers it totally **for metering** and **not at all for shaping**: it times the future, reads token
counts, fires telemetry, and returns `result` byte-identical — it never inspects `resp.text`.
Shaping happens one layer up and is spread over 5 sites with **3 mutually inconsistent** malformed-
JSON policies (repair-and-retry ×2 then dead-letter; silent `continue` ×2; hard error ×2). The MCP
surface validates *inbound* agent arguments rigorously and performs **zero** validation of
*outbound* model-authored content — `skill_propose` type-checks its `resources` array but passes
`instructions_md` through unexamined into the DB and then into a `<pre>`. Anyone citing that claim
for this leaf should cite this correction with it.

**One idea worth importing outright.** `brainiac`'s hand-rolled 262-line markdown parser exists as a
*security* decision, stated as doctrine (`markdown.ts:14-20`): *"We deliberately do NOT ship a
markdown library with `rehype-raw`: the content is model-authored, and the cheapest sanitizer is a
renderer that has no HTML escape hatch at all."* `personas-web` arrived at the identical
implementation twice with only an ergonomic justification ("lightweight, dependency-free") — the
repo with no model in the loop wrote the same defence as the repo with one, without knowing why it
was safe. That rationale is the reusable artifact, and it is the same conclusion
[`rendering-untrusted-content.md`](./rendering-untrusted-content.md) reached by measurement here.

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes — and for the highest-severity deviation in this document the type change is one line, while
no gate could have caught it at all.**

- **Widget/block kinds: type, decisively.** `cockpitWidgetRegistry` is typed
  `Record<string, ComponentType<CockpitWidgetProps>>`. That `string` key is the entire mechanism by
  which D1 happened: a prompt can name `kpi_tile`, the registry can not have it, and nothing
  anywhere is ill-typed. Two edits remove the class permanently:
  1. `export const cockpitWidgetRegistry = { … } as const satisfies Record<string, ComponentType<CockpitWidgetProps>>;`
     then `export type CockpitWidgetKind = keyof typeof cockpitWidgetRegistry;`
  2. **Derive the prompt fragment from those keys** rather than re-typing it — the Rust
     `EXPLAIN_KINDS` / `BRIEFING_WIDGET_KINDS` consts and the `constitution.md` alternations become
     one generated artifact, checked in like `src/lib/bindings/`. A kind the registry cannot render
     then cannot be named in a prompt, and a kind the registry gains is offered automatically.

  This is the `createLazySection` move from the contract: let the thing that owns the dangerous
  parameter be the only author of it. `SurfaceSpec` already demonstrates the endpoint — its zod
  discriminated union makes an unknown block *unrepresentable in the parsed value*, which is why
  `SurfaceRenderer`'s switch ends in `const _never: never = block` instead of a default case.
  **`compose_cockpit` (D4) should be a schema, not an allowlist.** A gate would only count these.
- **Model-named ids: type-adjacent, and the pattern already exists.** `sanitize_briefing_spec`
  derives its id sets from the delta document it also puts in the prompt. Generalise that as a
  helper signature — `fn validate_against<'a>(shown: &[&'a str], candidate: &str) -> Option<&'a str>` —
  so "the ids the model was shown" is a value threaded through, not a set re-collected per call
  site.
- **The brace scan (D3): gate, because no type is possible.** Any `&str` can be `rfind`-ed. Rust
  offers nothing that makes writing the loop again ill-typed, the population is 15 and fully
  enumerable, and a shared destination exists. That is exactly the ratchet case.
- **The prompt↔registry drift itself: neither, until the type lands.** Its healthy state is *zero*
  mismatches, which the census engine treats as a structural failure by design (§8 gap 4). It needs
  an assertion script — see Signal 2.

### Signal 1 — census rule `handrolled-llm-envelope-scan` (ships below)

**Condition it is a proxy for:** *the step that turns model output into a typed shape is re-derived
at the call site, so each copy silently disagrees about what the model actually emits.* An adopting
repo must re-derive its own proxy for that condition — `JSON.parse(reply)`, a bespoke
`stripFences`, a `Regex::new(r"\{.*\}")` — and **not** port this pattern. The precondition here is
specific and measured: this repo anchors on a JSON key and scans **backward**. `brainiac` has the
identical defect at `faithfulness.rs:133` written forward and unanchored, which this pattern scores
**zero** on. That is the `tables.md` / `form-field-and-validation.md` portability failure, avoided
by naming it.

**Not already gated.** All **65** rules in `scripts/census/rules.json` were read: none concerns
model output, JSON extraction, or component/action vocabularies. The closest neighbour,
`raw-inner-html` (owned by `rendering-untrusted-content.md`), keys on `dangerouslySetInnerHTML` —
a different condition (markup injection) on a different tree half. No overlap.

**Why a ratchet and not a review trigger:** unlike `raw-inner-html`'s population of 5, this one is
15 and the correct end state is **2** (the primitive plus its one legitimate streaming variant, once
Gap 2's `extract_balanced_object_from` lands). Every `--update` should move it down.

**Honest limitation, found by its own canary:** the pattern keys on the char literal `'{'`. A
canary written as `b[..p].rfind(char::from(123))` was **not** matched. That spelling appears zero
times in this tree today; a repo where it is idiomatic must widen the alternation.

```json
{"rules":[{"id":"handrolled-llm-envelope-scan","goldenPath":"docs/concepts/golden-paths/model-composed-ui.md","title":"A model reply's JSON envelope located by a brace scan re-derived at the call site","roots":["src-tauri"],"extensions":[".rs"],"signal":{"pattern":"\\[\\s*\\.\\.\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\]\\s*\\.\\s*rfind\\s*\\(\\s*'\\{'\\s*\\)","flags":"g","ignoreCommentLines":true,"description":"A slice-up-to-a-position followed by a backward scan for an opening brace (`blob[..pos].rfind('{')`) — the first move of the copy-pasted 12-line loop that pulls a model-authored JSON envelope out of free prose. PROXY FOR the stack-free condition: the step that turns model output into a typed shape is re-derived at the call site, so each copy silently disagrees about what the model actually emits (fanout.rs:440 omits the in_string state every other copy has, so a `}` inside a model-authored string truncates the slice). The destination exists and is generic: `athena_reaction::extract_json_envelope::<T>(blob, marker)` (athena_reaction.rs:855) IS this loop, with 2 adopters. PRECISION (all 15 matches read, 2026-08-15): 15/15 are model-reply parsers; 14 are violations and 1 (athena_reaction.rs:864) is the primitive itself, carried in the baseline rather than excluded because excluding it would exempt three real hand-rolls in the same file. PRECONDITION (must be re-derived per repo): this repo anchors on a JSON key and scans BACKWARD, and spells the brace as the char literal '{'. Sibling evidence that the CONDITION is universal but this SHAPE is not: brainiac has the same defect at faithfulness.rs:133 written as raw.find('{') + raw.rfind('}') — forward and unanchored — which this pattern scores ZERO on."},"baseline":{"files":9,"matches":15},"floor":900}]}
```

**Positive control** — the same anchors pointed at a tree containing *only* the compliant form.
Ships with a `-positive-control` id and **no baseline**, per the runner's contract (the merger skips
these by construction: they are evidence, not gates). The fixture is three files: an adopter calling
`extract_json_envelope::<T>(blob, marker)`, that adopter's doc comment quoting the forbidden line
`blob[..pos].rfind('{')` **verbatim**, and an out-of-scope forward `ext.find('{')` brace scan.

```json
{"rules":[{"id":"handrolled-llm-envelope-scan-positive-control","goldenPath":"docs/concepts/golden-paths/model-composed-ui.md","title":"POSITIVE CONTROL — the compliant form of the same parser must NOT match","roots":["mcui-fixture/compliant"],"extensions":[".rs"],"signal":{"pattern":"\\[\\s*\\.\\.\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\]\\s*\\.\\s*rfind\\s*\\(\\s*'\\{'\\s*\\)","flags":"g","ignoreCommentLines":true,"description":"The same anchors as handrolled-llm-envelope-scan, pointed at a tree that contains ONLY the compliant form (the shared extract_json_envelope call) plus (a) the forbidden shape written verbatim in a doc comment and (b) an out-of-scope forward brace scan. Any match here means the matcher keys on a token rather than on the shape."},"floor":1}]}
```

**Validation — run 2026-08-15 via `node scripts/census/run-census.mjs --rules <file> [--root <fixture>]`:**

| # | Scenario | Expected | Observed | Exit |
| --- | --- | --- | --- | --- |
| 1 | Rule as shipped, `--check` | baseline holds | `OK 9/9 files, 15/15 matches, 963 walked, floor 900` | **0** |
| 2 | **Positive control** — compliant-only tree, forbidden shape present in a doc comment | must **fail**: a matcher that fires here keys on a token | `structural: matched zero files anywhere`; log also reports `1 match(es) ignored on comment-only lines` | **1** |
| 3 | **Negative control** — one genuine hand-roll added to that same tree | must fire | `OK 1 file, 1 match, 3 walked` (run flips FAIL → OK) | **0** |
| 4 | Fault: new violation — a canary `.rs` added to the real `src-tauri/src/` | must fail | `files rose 9 -> 10 (+1)` · `matches rose 15 -> 16 (+1)` | **1** |
| 5 | Fault: silent drop — baseline claims 10/16 | must fail | `files dropped 10 -> 9 … a silent drop is a broken matcher more often than fixed code` | **1** |
| 6 | Fault: broken matcher — `roots` narrowed to one directory | must fail | `walked 11 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| 7 | Re-run, unchanged | baseline reproduces | identical to #1 | **0** |

Scenario 2 is the one that matters: the compliant fixture **quotes the exact forbidden line in
prose and still does not match**, so `ignoreCommentLines` is load-bearing rather than decorative —
and the forward `find('{')` in the same tree stayed silent, proving the rule discriminates between
two brace scans rather than matching "any brace scan."

### Signal 2 — a prompt↔registry parity assertion (Gap 1 / D1; not expressible as a census rule)

The healthy state is zero mismatches, which the engine treats as a structural failure by design.
The right host is a check script beside `scripts/docs/check-doc-sync.mjs`, wired into `npm run check`.
It should, for each of the four composition ops:

1. Extract the `"kind": "a|b|c"` alternation from its `OP:` line in
   `src-tauri/src/companion/templates/constitution.md`.
2. Extract the corresponding Rust allowlist (`EXPLAIN_KINDS`, `BRIEFING_WIDGET_KINDS`) where one
   exists.
3. Extract the key set of `cockpitWidgetRegistry`.
4. **Fail** when a prompted kind is absent from the registry, and **warn** when a Rust allowlist and
   the prompt disagree.

**How it fails loudly if its own precondition is absent** — the requirement the contract calls
non-optional, and the one `ci.yml` keeps violating. This check must **fail, not skip**, when: the
`OP:` line for a named op is not found (the prompt was reworded and the extractor silently matched
nothing); the registry object literal cannot be parsed; or any of the four ops it is told to check
yields an empty kind list. It must print all four op names with their extracted counts on success,
so a build log distinguishes "4 vocabularies verified, 55 kinds" from "checked nothing." A parity
check that greens out because a regex stopped matching is precisely the D1 failure, committed by the
gate written to catch it.

**Allowlist:** none. If `compose_dashboard` is kept, its 9 kinds must be implemented; if it is
deleted, the op, the prompt block, the executor arm, `CompanionDashboardWidgetKind` and
`companion_get_dashboard` go with it. There is no third state in which this check should be told to
look away.

**Once §9's type answer lands, delete this script.** A registry-derived prompt makes the assertion
unrepresentable rather than merely checked — which is the whole argument of "prefer a type over a
gate," and the reason this signal is second and not first.

---

### Verification of this document's own numbers

Every count was measured during composition. The census figures were produced by **two independent
implementations that agree exactly** — the census engine (whole-file regex, recursive walk) and a
separate script that scans **line by line**, locates the token `rfind` first, then inspects the
preceding characters with string operations rather than one regex: both report **9 files, 15
matches, 963 files walked**, with the same per-file distribution. The rendering figures came from
executing fixtures against the real components under Vitest/jsdom, not from reading them; both
scratch probes and both scratch rule files were deleted after the numbers were recorded, and the
working tree is unchanged.

Two claims were **retracted before reaching this document**. The first: an initial reading of
`filterMetaContent` predicted that a JSON-shaped streaming reply would fire `silentCatch` on
*every* frame; measurement showed the predicate (`starts with [ or {` **and** `ends with ] or }`)
gates it to 4 of 66 prefixes, 3 of which fail — real, but an order of magnitude smaller, and D11 is
written to the measured number. The second: `ALLOWED_ACTIONS` was reported to me as 53 entries; a
literal-string count of the slice gives **54**, and 54 is what §6 cites.

One prediction of my own was **disproved and is recorded as such**: I expected truncated markdown
to be the leaf's main hazard, on the brief's authority. It is not — 0 throws and 0 mis-renders over
379 truncations — and the effort spent proving that is what surfaced D2, which is the opposite
defect and a worse one.
