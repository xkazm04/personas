# Golden path — Copy to clipboard

> Situation node: `ui-system/chrome-and-feedback/copy-to-clipboard` (recurrence 67) ·
> [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2a874e692`. Sweep: **4,829 `.ts`/`.tsx` files**
> walked by the census engine itself — exactly `frontend.tsFiles` in
> [`shared-facts.json`](../shared-facts.json). (An intermediate run reported 4,830; the
> tree gained and lost a file mid-composition. The published figure is the one the
> re-extraction produced from this document's own rule blocks.) · full reads of
> `CopyButton`, `useCopyToClipboard`, `useKeyedCopyFlag`,
> `Tooltip`, `AriaLiveProvider`, `UuidLabel`, `prefer-shared-clipboard.cjs`,
> `scripts/census/lib/engine.mjs` and all 65 census rules · every `copyText` call site
> classified by **two independent parsers** that disagreed on 4 sites and were
> reconciled by hand · **the primitive EXECUTED under Vitest + jsdom** with the
> clipboard stubbed to deny, to absent, and to succeed (11 assertions, all passing) ·
> a convergence census of **two** sibling repos (`personas-web`, `brainiac/console`).
> Dimensions: **ui · function · resilience · security · code-quality** (+ i18n, which
> the evidence forced in).
> **Settles:** what happens when a user presses a copy affordance — what reaches the
> clipboard, what tells them it worked, what happens when it didn't, and who is allowed
> to hear any of it.
>
> Corpus counts cite [`shared-facts.json`](../shared-facts.json); everything else was
> measured during composition. Deviations become `violating` cells.
>
> **The brief's three inherited findings, re-checked at the working tree — all three
> hold, and one is sharper than stated.** (1) `secret-display-and-transfer.md`'s
> chokepoint claim: **confirmed** — 2 production `navigator.clipboard.writeText` calls
> in 4,830 files. (2) `tooltip.md`'s double-tooltip claim: **confirmed by execution**,
> not by reading — rendering `CopyButton` and focusing it produces a native
> `title="Copy"` *and* a `role="tooltip"` portal node reading `"Copy"`, simultaneously,
> at all 30 render sites. (3) The `ExecutionLogViewer` copy-on-a-raw-blob question is
> ruled on in §2 and §5.9. **One inherited number is wrong and the correction matters:**
> that path reports "11 secret copies, 3 wipe" against `copyText` — true, but it counts
> `copyText` callers only. Adding the 42 hand-rolled affordances this path found, the
> denominator of *copy affordances in this app* is **72**, not 11.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically
separated and each clause carries its warrant, so an adopting repo can tell physics from
local calibration. No file path, primitive name or count appears below this line until
the head ends.

> **P1 — physics.** The clipboard is the only affordance in a UI whose result the user
> cannot see. Every other control changes something on screen; this one changes an
> invisible buffer in another process. Therefore the confirmation *is* the feature. A
> copy affordance that copies correctly and says nothing has failed at its job.
>
> **P2 — physics.** A clipboard write can be refused — by permission, by a
> non-secure context, by a webview policy, by focus having left the document. Any
> design that treats the write as infallible is wrong on a path that fires in
> production, not in theory.
>
> **P3 — physics.** *Therefore*: never claim success before knowing. The success
> signal must be causally downstream of the write's own result, not of the click. A
> checkmark that appears because a button was pressed is a lie the user has no way to
> detect — they will discover it at the paste, in another application, after the source
> is gone.
>
> **P4 — physics, and the one this leaf most often gets wrong.** Failure must be
> *visible*, not merely *not-success*. Suppressing the checkmark on failure is correct
> and insufficient: "nothing happened" and "your copy was refused" render identically,
> so the user re-presses a button that will never work.
>
> **P5 — physics.** A confirmation delivered only as a colour change and an icon swap
> is delivered to sighted users only. The clipboard result is a state change with no
> focus move, which is the exact case assistive technology cannot observe on its own.
>
> **P6 — physics.** What lands on the clipboard must be what the user believes they
> copied. Where the display is abbreviated, masked, or filtered, the divergence is a
> deliberate decision that must be stated at the affordance — silently copying more
> than is shown is how a masked secret leaves a screen that appears to be protecting it.
>
> **P7 — ergonomics.** The clipboard is a shared, persistent, cross-application buffer
> with no owner and no expiry. Deciding *what may be put there* is a separate and
> stricter decision than deciding what may be displayed.
>
> **P8 — ergonomics.** "Copy" and "Copied" are product copy on the same footing as a
> button label. A copy affordance that hardcodes them is untranslated UI.

---

## Boundaries with the neighbouring paths, settled in prose

This leaf sits at the intersection of four composed paths and takes care not to
re-litigate any of them.

| Question | Owner |
| --- | --- |
| May this **value** be copied at all? Must it be wiped afterwards? | [`secret-display-and-transfer.md`](./secret-display-and-transfer.md) |
| **Did the copy happen, and how does the user find out?** | **here** |
| Which region speaks a change nobody focused, how urgently, how often | [`screen-reader-announcements.md`](./screen-reader-announcements.md) |
| **Whether a copy result is a thing that gets spoken at all** | **here** |
| How explanatory text attaches to a control, and who can reach it | [`tooltip.md`](./tooltip.md) |
| Whether a transient notification is the right surface, and its tone | [`toasts.md`](./toasts.md) |

Three seams are load-bearing and worth stating exactly:

**With `secret-display-and-transfer.md`.** That path owns the *payload* question and
answered it: a secret copy needs a TTL wipe, 8 of 11 don't have one, and Windows
Clipboard History defeats all three that do (0 repo-wide references to any exclusion
API — **re-confirmed here**). This path owns the *transaction*: whether the write
happened and whether anyone was told. The two are independent failures and their fixes
do not imply each other. `FieldCaptureHelpers.tsx:91` is that path's **exemplar** (it
wipes correctly) and this path's **deviation** (it never checks whether either the copy
or the wipe succeeded, and it schedules a 30-second wipe from a write it cannot confirm
occurred). Both readings are correct.

**With `screen-reader-announcements.md`.** That path owns the announcer: it confirmed
`AriaLiveProvider` exists and is mounted exactly once (`App.tsx:322`), and it gates
live regions *born holding their message*. This path's condition is the complement —
**no live region at all**, at every copy site in the app — and the two census
populations are disjoint by construction (its signal keys on `aria-live` / `role="status"`
presence; mine keys on `copyText` call shape; **0 files overlap**).

**With `tooltip.md`.** That path already gates the native `title` attribute
(`native-title-tooltip`, 571 files / 1,108 matches) and `CopyButton.tsx:76` is inside
that population. **This path therefore proposes no tooltip gate** — it would be
duplicate enforcement. What it adds is the *reason the obvious fix is wrong here*: for
an icon-only `CopyButton`, `title` is the button's **only** accessible name (measured:
`aria-label` is `null`, `textContent` is `""`). Deleting the `title` to satisfy that
gate would leave 30 nameless buttons. See §7 D3.

---

## 1 Trigger

- "Add a copy button to this ID / URL / token / JSON / log."
- "Let them copy the command so they can paste it in a terminal."
- "Click the row to copy the cell value." / "Copy this whole table as markdown."
- "Show a toast when they copy it." / "Make the icon turn into a checkmark."
- "Copy the export bundle to the clipboard so they can move it to the other machine."
- "Why does it say Copied but nothing pasted?"

**If you are about to type any of these, you are in this situation:**
`navigator.clipboard.writeText(…)` · `document.execCommand('copy')` ·
`const [copied, setCopied] = useState(false)` next to a `Copy` icon ·
`await copyText(x); setCopied(true)` · `copyText(x).then(() => addToast(…, 'success'))` ·
`try { await copyText(x) } catch { … }` · `{copied ? <Check/> : <Copy/>}` ·
`setTimeout(() => setCopied(false), 2000)`.

---

## 2 The one way

**Render `<CopyButton text={…} />` and write no state, no timer, no icon branch and no
`catch`.** The primitive owns the write, the 2-second flash, the icon morph, the
reduced-motion path and the empty-string guard, and it is already correct on the one
thing hand-rolled code gets wrong: it flashes "Copied" **only** when the write resolved
true. When the copy is not a button — a clickable table cell, a row action, a keyboard
shortcut — use `useCopyToClipboard()` for a single target or `useKeyedCopyFlag()` for a
list, and render the flag they hand you; both gate on the same boolean. Reach for
`copyText()` directly **only** from module scope where hooks cannot run, and when you
do, **bind its result** — `const ok = await copyText(x); if (!ok) return;` — because
`copyText` **never rejects**, so a `try`/`catch` or a `.catch()` around it is dead code
and everything after it runs on a clipboard that may be empty. Copy exactly the
expression you rendered: if the display is truncated, masked, or filtered, either copy
the same thing or say at the affordance that you are copying more. And **before you
decide what to copy, ask [`secret-display-and-transfer.md`](./secret-display-and-transfer.md)
whether the value is allowed on the clipboard at all** — a copy affordance on an
arbitrary blob (an execution log, a raw `output_data`, a captured webhook request) is a
decision to publish whatever happens to be in it, taken once, on behalf of every future
value that flows through.

If two answers seem correct, reach for **`<CopyButton>`** first. It is the only one of
the four that cannot be got wrong later: the other three hand you a boolean you are free
to ignore, and 32 of 36 direct callers in this repo ignore it.

---

## 3 Mandated primitives

| Primitive | What it gives you |
|---|---|
| `@/features/shared/components/buttons/CopyButton` (`CopyButton.tsx:36`) | The whole affordance. Idle/copied icon morph via `framer-motion`, an emerald flash, a 2 s auto-reset, `useMotion()`-aware transitions (`:55-56`), a `focus-ring`, a translated tooltip, and an **empty-string guard** (`:62-67`) that refuses to flash success for a zero-length copy — *"claiming success is theater."* |
| `useCopyToClipboard(timeout = 2000)` (`useCopyToClipboard.ts:27`) | `{ copied, copy }`. `copied` flips **only** when the write resolved true (`:42-47`), and the reset timer is cleared on unmount (`:31-38`). Use when the affordance is not a button. |
| `useKeyedCopyFlag<K>(timeout = 2000)` (`useKeyedCopyFlag.ts:20`) | `{ copiedKey, copy(key, text) }` — the list/table variant, so one flag serves N rows instead of N booleans. Same `ok` gate (`:35-40`), same unmount cleanup. **6 adopters.** |
| `copyText(text)` (`useCopyToClipboard.ts:11`) | The one sanctioned `navigator.clipboard.writeText`. **Never throws**; posts a Sentry breadcrumb through `silentCatch` and resolves `false`. For module-scope callers only. |
| `useAnnounce()` / `announceImperative()` (`AriaLiveProvider.tsx:135,:158`) | The app's single announcer — two `sr-only` regions (polite + assertive) with a key-remount so duplicate consecutive messages are re-spoken, and a 150 ms drain queue so a burst is not collapsed into one utterance (`:34-59`). **Zero copy sites use it. This is the leaf's largest gap.** |
| `custom/prefer-shared-clipboard` (`eslint-rules/prefer-shared-clipboard.cjs`) | The rule that holds the chokepoint. Reports any `*.clipboard.writeText` outside the two primitive files (`:47`). `"warn"` at `eslint.config.js:109`. |
| `t.common.copy` / `t.common.copied` / `t.common.copied_to_clipboard` | The canonical labels. Do **not** declare a new one — §7 D6 counts what happened when 37 people did. |

**Do not invent a fourth copy hook, and do not define a component named `CopyButton`.**
Two files already do, both shadow the shared name, and both hardcode English (§7 D2).

---

## 4 Steps

1. **Ask what may be copied before asking how.** If the value is a credential, a raw
   log, an unmasked payload, or a reconstructed request with headers, stop and read
   [`secret-display-and-transfer.md`](./secret-display-and-transfer.md) §2. That
   decision is upstream of every step below and cannot be repaired by a better button.
2. **Decide whether the copied text equals the displayed text.** If the UI shows
   `value.slice(0, 8) + '…'`, or a masked JSON, or a filtered subset, write down which
   one the clipboard gets and why. If they differ, the affordance must say so — its
   tooltip is the place (`t.shared.copy_full_id` is the existing precedent, at
   `UuidLabel.tsx:33`).
3. **Render `<CopyButton text={theExactExpression} />`.** Pass `label` when the button
   sits in a toolbar with room for words; omit it for a dense row and let the tooltip
   carry the name. Never pass a locally-composed label string — use `t.*`.
4. **If the affordance is not a button, take the flag, not the write.**
   `const { copied, copy } = useCopyToClipboard()` for one target;
   `const { copiedKey, copy } = useKeyedCopyFlag<string>()` for a list, then
   `copiedKey === row.id`. Render their flag directly. Do not add a `useState` beside
   them, and do not add a `setTimeout` — both hooks own their reset and their cleanup.
5. **From module scope, bind the boolean.** `const ok = await copyText(text); if (!ok)
   { …tell the user… } ` — the two correct instances in the repo are
   `ChatMessageContent.tsx:70-74` and `DevInspector.tsx:45-46`. **Do not wrap
   `copyText` in `try`/`catch` and do not chain `.catch()`**: it never rejects, and
   both shapes produce an error handler that cannot run (§5.2, measured 5 times).
6. **Say it out loud.** Until the primitive owns this (§9's type answer), a copy
   affordance that matters — an export, a credential, a share link, anything the user
   will act on elsewhere — must call `announce(t.common.copied_to_clipboard)` on
   success and `announce(t.common.copy_failed, 'assertive')` on failure. A colour
   change is not a confirmation for a screen-reader user; measured, the icon-only
   `CopyButton` presents an **identical** accessibility tree before and after a
   successful copy.
7. **Make failure visible, not just non-successful.** A refused clipboard must render
   something the user can read — the toast path (`toasts.md`) is the sanctioned
   surface. "The checkmark did not appear" is not a failure state; it is the idle
   state.
8. **Ask whether the type can make this unnecessary before writing any of step 5–7.**
   It can, and it should — see the "prefer a type over a gate" answer in §9. Every rule
   in steps 5 through 7 exists only because the primitive currently returns a value the
   caller may ignore and says nothing on either branch. If you are adding a *sixth*
   call site that remembers to do this by hand, fix the primitive instead.
9. **And then stop.** `CopyButton` owns the flash, the morph, the timer, the reduced-motion
   branch and the empty guard. `useCopyToClipboard` / `useKeyedCopyFlag` own the flag
   and its cleanup. `copyText` owns the write and the breadcrumb. `Tooltip` owns the
   hover text. `AriaLiveProvider` owns the announcement. If you are writing a
   `useState`, a `setTimeout`, a `catch`, or an icon ternary next to any of them, you
   are re-implementing a primitive that is already correct.

---

## 5 Anti-patterns

1. **Claiming success from the click instead of from the write.**
   `copyText(md).then(() => addToast(session_output_copied, 'success'))`
   (`CreativeStudioPanel.tsx:330-336`). *Failure mode:* `copyText` resolves `false` on
   failure rather than rejecting, so `.then` runs on the denied path and the user is
   told the copy succeeded when the clipboard is untouched. **Executed, not inferred:**
   with the clipboard stubbed to throw `NotAllowedError`, the handler order is
   `["THEN-RAN"]`. The `.catch` never fires.

2. **Writing a `catch` for a function that cannot throw.** `try { await copyText(x);
   setCopied(true); } catch { addToast(copy_failed, 'error'); }` — the shape at
   `PersonaOverviewCardList.tsx:19-25`, `PrBridge.tsx:227-232` (×4),
   `CreatedKeyDialog.tsx:68-71`, `DryRunModal.tsx:25-31` and a dozen more. *Failure
   mode:* the developer believes they handled failure; a reviewer reading the diff
   agrees; the error branch is unreachable and the success branch is unconditional. The
   defect is invisible from the call site — you have to open the primitive to see it.
   `PrBridge` compounds it: `markDone('copy_body')` advances a workflow checkpoint on
   a write nobody confirmed.

3. **Suppressing the checkmark on failure and calling it handled.** `CopyButton`
   correctly refuses to flash on a failed write. Measured on the real component with
   the clipboard denied: the label stays `"Copy key"`, no emerald class, `0` elements
   with `role="alert"`, no toast. *Failure mode:* the correct-looking behaviour and the
   button-is-broken behaviour are pixel-identical, so the user presses again. Not
   lying is not the same as telling.

4. **Confirming with colour and shape only.** Measured on the icon-only `CopyButton`
   before and after a successful copy: `title` unchanged (`"Copy"`), `aria-label`
   `null` in both, `textContent` `""` in both, and `0` `aria-live` / `role="status"` /
   `role="alert"` / `.sr-only` nodes in the document at either moment. The only
   difference is a CSS class and an SVG. *Failure mode:* for a screen-reader user the
   button does nothing, forever, with no error — this leaf's exact analogue of the
   252-of-252 silent busy states.

5. **Hand-rolling the affordance because the state "is only three lines".** 42 of them
   exist. Between them they disagree on the reset timeout, on whether there is a
   tooltip, on whether the button has an accessible name (7 of 42 have `aria-label`),
   and on which of 12 different i18n keys spells the word "Copied". *Failure mode:*
   the drift is not in any one file, so no reviewer ever sees it.

6. **Defining a component named `CopyButton`.** `ExecutionDetailContent.tsx:28` and
   `setupMarkdownComponents.tsx:14` (the latter `export`ed). *Failure mode:* a reader,
   a grep, and a future census signal keyed on `<CopyButton` all count these as
   adoption. It is the contract's fifth gate-failure mode in miniature — the check
   confirms you arrived somewhere named right.

7. **Copying more than you render.** `ExecutionDetailContent.tsx:166-167` puts
   `<CopyButton text={execution.output_data} />` one line above
   `maskSensitiveJson(execution.output_data)`. *Failure mode:* the masking is theatre
   for exactly as long as nobody presses the button four columns to the left. (Also
   `secret-display-and-transfer.md` D8 — same site, and it is worth two entries.)

8. **A copy affordance that is invisible until hovered.** `UuidLabel.tsx:37` is
   `opacity-0 group-hover/uuid:opacity-100` with no focus-visible companion. *Failure
   mode:* the control is keyboard-focusable and permanently transparent, so a keyboard
   user tabs onto a button they cannot see. (The same component copies the full value
   while displaying `slice(0, 8)` — that one is legitimate, and legitimate *because*
   the tooltip at `:25` shows the whole id.)

9. **Putting a copy button on an arbitrary blob.** `ExecutionLogViewer.tsx:92` copies a
   whole raw execution log; `WebhookRequestInspector.tsx:211` copies a reconstructed
   `curl` including the sender's original headers. *Failure mode:* the affordance is
   authored once against today's contents and then silently governs every value that
   ever flows through the blob. **The ruling this leaf owes:** a copy affordance on a
   blob is only permissible when the *producer* of the blob has a stated redaction
   contract on the read path — not on the write path. `ExecutionLogger::log` masks new
   writes; `get_execution_log` returns the historical corpus verbatim
   (`secret-display-and-transfer.md` D1), so today this button is not permissible. The
   button is not the fix and not the bug; it is the amplifier.

10. **Two tooltips on one control.** `CopyButton.tsx:76` sets a native `title` and
    `:140` wraps the same button in `<Tooltip>`. Both render, both say "Copy", one is
    keyboard-reachable and one is not. *Failure mode:* on hover the user gets a
    double-decker; and the naive fix (delete the `title`) silently removes the only
    accessible name an icon-only instance has.

11. **Declaring your own "Copied" string.** 37 i18n keys hold four English strings
    between them. *Failure mode:* 518 translation units, 14 locales, for four words —
    and a `copy_failed` message that no code path can reach still costs 14 translations
    (§7 D6).

12. **Reaching for `document.execCommand('copy')`.** Avoided here, deliberately —
    **0 occurrences in 4,830 files**, and `copyText`'s `try`/`catch` already degrades
    correctly on a missing `navigator.clipboard` (measured: resolves `false`, does not
    throw). The sibling that kept the fallback pays for it with **5** duplicated
    `legacyCopy` helpers. Copy this posture.

---

## 6 Evidence

**The one site to copy:**
**`src/features/plugins/fleet/sub_harvest/FleetHarvestPanel.tsx:73-76`** —
`<CopyButton text={…} label={…} copiedLabel={t.plugins.fleet.harvest_copied} />`. Four
props, no state, no timer, no `catch`, no icon ternary, and every string translated. It
is what every one of the 42 hand-rolled affordances was trying to be.

**The one site to copy for the non-button case:**
**`src/features/agents/components/ChatMessageContent.tsx:69-75`** — the only
hand-written handler in the repo that gets the failure contract right:

```ts
const ok = await copyText(rawText);
if (!ok) return;                    // ← the line 32 other call sites do not have
setCopied(true);
addToast(t.agents.chat_thread.code_copied, 'success');
```

Other exemplary sites, each for one specific move:

| Site | What it demonstrates |
|---|---|
| `useCopyToClipboard.ts:11-19` | The chokepoint: one `writeText`, a `silentCatch` breadcrumb, `Promise<boolean>`, never throws. |
| `useCopyToClipboard.ts:42-47` · `useKeyedCopyFlag.ts:35-40` | `if (!ok) return;` **before** `setCopied` — the whole of P3, twice, in two lines. |
| `CopyButton.tsx:62-67` | The empty-string guard, with the reasoning in the comment: *"claiming success is theater."* |
| `CopyButton.tsx:55-56` | `useMotion()` collapses both transitions to `duration: 0` under reduced motion — the flash still happens, the animation does not. |
| `useKeyedCopyFlag.ts:1-19` | The list variant that stops N rows needing N booleans; its docstring is the usage example. |
| `AriaLiveProvider.tsx:34-59` | The announcer's drain queue — the reason a burst of copies would not collapse into one utterance, if anything called it. |
| `CloudWebhooksTab.tsx:282-295` | The sanctioned **managed** shape: `useKeyedCopyFlag` owns the per-row flag, `<CopyButton copied={copiedId === …} onCopy={…}>` renders it. Two rows, one flag. |
| `FieldCaptureHelpers.tsx:98-116` | The secret-wipe TTL (owned by `secret-display-and-transfer.md`, cited here so nobody re-derives it). |
| `eslint-rules/prefer-shared-clipboard.cjs:47` | An allowlist expressed as a filename regex on the two primitives — no `exclude` list to go stale. |

### Convergence — measured against two siblings, and it does not flatter this repo

| Clause | `personas-web` (Next.js, 11 write sites) | `brainiac/console` (Next.js, 4 write sites) | Ruling |
|---|---|---|---|
| **Only claim success once the write resolves** | 9 of 13 affordances gate correctly; 2 optimistic (`HeadingAnchor.tsx:28-37` paints "copied" from an unawaited promise) | **4 of 4 gate correctly, and it was earned:** `docs/harness/refactor-bughunt-2026-07-14/FIXES-WAVE-5.md:22` records the exact fix — *"'✓ copied' was shown unconditionally, losing a one-time secret on a blocked clipboard — now only flips on a resolved write"* | **PHYSICS** |
| **The copy result must reach assistive technology** | **Reinvented once**, with the reasoning written down: `guide/blocks/CopyButton.tsx:79-83` renders `role="status" aria-live="polite" sr-only` under the comment *"the button's visible label swap alone is not reliably announced"* | **0 of 4**, and `AddressBar.tsx:70-71` is worse than absent — a static `aria-label` overrides the changing text, guaranteeing the state change never reaches AT | **Physics, unevenly discovered** |
| **Failure must be visible, not merely non-successful** | 1 of 13 renders an explicit "Copy failed" (`guide/blocks/CopyButton.tsx:52`); 4 swallow silently | 1 of 4 (`AddressBar.tsx:81`); the other 3 set `copied=false`, which renders as "not yet clicked" | **Physics, weakly discovered** |
| **One chokepoint owns the write** | **Absent.** 11 of 11 call the browser API directly; **5** duplicated `legacyCopy` helpers, one per file | **Absent.** 4 of 4 raw; 0 shared helpers; `Button.tsx:11-14` explicitly refuses behaviour | **House convention** |
| **One tooltip per control** | **0** double-tooltips in 13 affordances | **0** (no tooltip primitive exists) | **No trace anywhere — local defect** |
| A copied secret must be wiped | Condition **absent** — 0 of 11 writes carry a secret | 2 of 4 carry a one-time API key, **0 wipe**, and the gap is logged open at `con-keys.md:24-32` | **Untested / open everywhere** |
| `execCommand('copy')` fallback | 5 | 0 | personas: **0** |

**Report honestly where convergence contradicts this document.** Two results cut against
§2 and both are stated rather than smuggled:

**(a) The chokepoint — this path's central prescription — was reinvented nowhere.** Under
the contract's rule, that makes it suspect as local calibration. It survives on the
same ground the secret path's `SecureString` clause survives on: **the defect converged
even though the fix did not.** Both siblings pay the exact price a chokepoint prevents —
`personas-web` maintains 5 duplicated fallback helpers and 13 implementations that
disagree on whether failure is visible; `brainiac`'s 4 disagree on the reset timeout
(2000 / 2000 / none / none). Neither repo *discovered* the chokepoint, and both are
demonstrably worse off for it. Note also the honest asymmetry: **this repo's chokepoint
is real and its destination is not correct** — see the fifth-failure-mode note in §9.

**(b) The double-tooltip clause has no trace in either sibling.** Per the contract, it is
therefore a **local defect, not doctrine** — which is exactly right, because the fix
lives in `tooltip.md` and this path defers to it rather than gating it.

**The earned lesson, stated because this leaf is a clean instance of it: convergence
measures discoverability, not whether a requirement is real.** The screen-reader clause
was rediscovered in precisely the repo that ships a public documentation site — a
surface with an accessibility-conscious audience and a reason to look — and not in the
internal console next door. The desktop app's blind users do not exist any less than the
guide site's. A clause found once, in the repo most likely to look, is a clause about
*who audits*, not about *who needs it*.

---

## 7 Deviations

Ordered by blast radius. Every entry was read or executed, not inferred.

### D1 — 32 clipboard writes cannot know whether they happened; 18 claim success anyway
`src/**` — **22 files / 32 matches**, measured with the census engine; classified by two
independent parsers.

`copyText` returns `Promise<boolean>` and **never rejects** (executed: with the write
stubbed to throw `NotAllowedError`, `copyText` neither threw nor resolved truthy; with
`navigator.clipboard` set to `undefined`, same). 32 call sites bind that boolean to
nothing. **18 of them then claim success** — `setCopied(true)`, an `addToast(…,
'success')`, or in `PrBridge`'s case `markDone(…)`, a workflow checkpoint. The sharpest
five chain a `.catch()` directly onto the promise, so they carry a written error handler
that is unreachable:

| Site | Shows on failure | Error handler that cannot run |
|---|---|---|
| `ExecutionLogViewer.tsx:28-35` | "Copied" via managed `<CopyButton>` | `setLogError(t.agents.executions.copy_log_failed)` at `:34` |
| `CreativeStudioPanel.tsx:330-336` | success toast | `.catch(silentCatch('Copy session markdown'))` |
| `Gallery2D.tsx:220-222` | success toast | `.catch(silentCatch('Copy asset path'))` |
| `FleetPairDevice.tsx:65-70` | `setCopied(true)` | `.catch(silentCatch('FleetPairDevice:copy'))` |
| `DriveDetailsPane.tsx:180-181` | **nothing at all** — no `.then`, no flag | `.catch(silentCatch('drive:copy-path'))` |

The `try`/`catch` form of the same mistake is more common: `PrBridge.tsx` ×4,
`PersonaOverviewCardList.tsx:19-25`, `CreatedKeyDialog.tsx:68-71,:76-79`,
`DryRunModal.tsx:25-31`, `McpServerInfoPanel.tsx:51-57`, `TwinWikiPanel.tsx:62-68`,
`RecipeEditor.tsx:127`. Two sites are subtler and worth separating:
`BundleExportDialog.tsx:164-178,:186-200` and `DriveSignaturesPanel.tsx:55-62` wrap
`copyText` in a `try` that **also** wraps a throwing IPC call, so the catch is reachable
for the IPC failure and unreachable for the clipboard failure — the error message the
user gets on a denied clipboard is no message.
**Fix:** the type change in §9 (one edit, all 32). Failing that, `const ok = await
copyText(x); if (!ok) …` per site, and delete the dead handler rather than leaving it as
false reassurance.

### D2 — 42 hand-rolled copy affordances; adoption of the primitive is 30/72
`src/**` — 42 `<button>` elements containing a `Copy`/`Check` icon inside a file that
imports a copy primitive but does not render the shared `<CopyButton>`, across **34
files**. Against **30** shared-primitive render sites in **24 files**, adoption is
**42%**.

The 24 render sites reconcile exactly against the import graph: 13 files import
`…/buttons/CopyButton` directly, 7 via the `…/buttons` barrel, 2 via `../buttons` = **22
importers**, and the remaining **2** render a *locally defined* component of the same
name (`ExecutionDetailContent.tsx:28`, `setupMarkdownComponents.tsx:14`). Both shadows
hardcode English — `{copied ? 'Copied' : label}` at `:34` and `{copied ? 'Copied' :
'Copy'}` at `:34` respectively — in a 14-locale app.
**Fix:** replace the 42; delete the 2 shadows. `CopyButton` covers the icon-only, the
labelled, and the externally-managed cases, so the migration is prop-for-prop everywhere
except list rows, which get `useKeyedCopyFlag` + managed mode
(`CloudWebhooksTab.tsx:282-295` is the worked example).

### D3 — every copy confirmation in the app is silent to assistive technology
`src/**` — **0** of 42 hand-rolled buttons contain an `aria-live`, a `role="status"`, a
`role="alert"` or an `sr-only` node. Of **75 files** owning any copy affordance, exactly
**1** contains a live region anywhere in the file, and it is not for the copy.

`CopyButton` itself was **executed** rather than read. Icon-only (the dominant form),
before and after a successful copy:

| | before | after |
|---|---|---|
| `title` | `"Copy"` | `"Copy"` |
| `aria-label` | `null` | `null` |
| `textContent` | `""` | `""` |
| `aria-live` / `role="status"` / `role="alert"` / `.sr-only` in document | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

The labelled form does change its accessible name (`"Copy key"` → `"Copied"`), which is
better but is a name change on a focused element — inconsistently announced, and it is
also why the `title` is `null` there. **The app already owns the fix and does not use
it:** `AriaLiveProvider` is mounted once and exposes both `useAnnounce()` and
`announceImperative()`, the latter callable from `copyText` itself.
**Fix:** §9's type answer — announce from the primitive, once, for all 72 affordances.
**Do not** fix this by deleting `CopyButton.tsx:76`'s `title` to satisfy
`native-title-tooltip`: measured, `title` is the icon-only button's **only** accessible
name, and removing it without adding `aria-label` turns a silent button into a nameless
one.

### D4 — managed mode is the hole in the primitive's own guarantee
`CopyButton.tsx:52-53,:58-68` · 5 managed call sites

Internal mode gates the flash on `ok`. Managed mode (`copied` supplied, `onCopy: () =>
void`) hands the verdict to the caller and **calls no clipboard at all** — executed:
`onCopy` fired once, `writeText` zero times. All 5 managed sites feed `copied` from a
flag set after an unverified write, and `ExecutionLogViewer.tsx:92` is the one where it
bites: its `handleCopyLog` (`:26-35`) sets `copied` inside a `.then()` that runs on
failure, so the **shared, correct** primitive renders "Copied!" on a denied clipboard.
**Fix:** `onCopy?: () => Promise<boolean>` (§9). Precedent in this repo:
`AsyncButton`'s returns-a-promise `onClick`, which CLAUDE.md already names as the
sanctioned busy-state shape for exactly this reason.

### D5 — the render is masked and the copy beside it is raw
`ExecutionDetailContent.tsx:166-167`

`<CopyButton text={execution.output_data} />` and
`maskSensitiveJson(execution.output_data)`, adjacent lines, same value, two policies.
The `showRaw` toggle at `:55` governs the render and not the copy.
**Fix:** copy the same expression the block renders —
`showRaw ? execution.output_data : maskSensitiveJson(execution.output_data)`. One line.
(Also `secret-display-and-transfer.md` D8; it is a payload defect there and a
display-divergence defect here.)

### D6 — 37 i18n keys hold four English strings; one of them is unreachable
`src/i18n/locales/en.json` — **138** keys mention copy/clipboard.

`"Copy"` is declared **13** times (`common.copy`, `shared.copy_tooltip`,
`vault.cli_panel.copy`, `plugins.drive.ctx_copy`, …), `"Copied"` **12** times,
`"Copied to clipboard"` **6**, `"Copied!"` **6** — **37 keys, 4 distinct strings, ×14
locales = 518 translation units.** Five keys hold a copy-*failure* message, and their
call sites are the dead `catch` blocks of D1: `agents.persona_list.copy_failed` and
`plugins.dev_tools.pr_bridge_copy_failed` are reachable only from handlers that cannot
run, and **`agents.persona_overview.failed_copy` has zero call sites in `src/**` at
all** — a fully dead key, translated 14 times. `check-coverage.mjs` fails on *extras*
(keys present in a locale and absent from `en`), so a key present in `en` and referenced
by nobody is invisible to the gate.
**Fix:** collapse to `t.common.copy` / `t.common.copied` / `t.common.copied_to_clipboard`
/ `t.common.copy_failed` as the shadows and hand-rolls are migrated under D2; delete
`failed_copy`.

### D7 — a copy affordance that is invisible on keyboard focus
`UuidLabel.tsx:34-44`

`opacity-0 group-hover/uuid:opacity-100` with no `focus-visible:opacity-100` and no
`focus-within` on the parent. The button is in the tab order and renders fully
transparent when focus lands on it. It is also a shared `display/` primitive, so the
defect ships everywhere ids are rendered.
**Fix:** add `focus-visible:opacity-100` (and `group-focus-within/uuid:opacity-100` for
the wrapper). Its copied-vs-displayed divergence (`slice(0, 8)` shown, full value
copied) is **correct** and should be left alone — `Tooltip content={value}` at `:25`
discloses it.

### D8 — a copy affordance sits on two blobs with no read-path redaction contract
`ExecutionLogViewer.tsx:92` (raw execution log) · `WebhookRequestInspector.tsx:211`
(reconstructed `curl`, sender headers included)

Ruled on in §5.9. Both are downstream of
[`secret-display-and-transfer.md`](./secret-display-and-transfer.md) D1/D9 and neither is
fixable in this leaf: the button is correct once the producer is.
**Fix:** sanitise on the read path (that path's D1), then the affordance is permissible
as-is. Until then, this is the strongest argument in the repo for the classification
parameter that path proposes.

### D9 — the `.catch()` on a never-rejecting promise is a repo-wide reading hazard
5 sites (table in D1) · plus ~13 `try`/`catch` equivalents

Called out separately from D1 because the *fix* is different. D1's fix is to bind the
boolean; this entry's fix is to **delete the handler**, because leaving it is worse than
never having written it: the next reader greps for error handling around copy, finds it,
and stops looking.
**Fix:** delete, and let `copyText`'s own `silentCatch` breadcrumb be the telemetry
(it already is — `useCopyToClipboard.ts:16`).

### Cleared — claims this sweep tried to confirm and could not

A cleared claim is worth as much as a confirmed one.

- **The chokepoint holds.** **2** production `navigator.clipboard.writeText` calls in
  4,830 files: the primitive (`useCopyToClipboard.ts:13`) and one `eslint-disable`d PTY
  selection copy (`fleetTerminalManager.ts:369`). One further occurrence is a test
  assertion, one a doc comment, one the catalog. `custom/prefer-shared-clipboard` is
  registered and active at `eslint.config.js:109`.
- **There is no `execCommand` fallback and no `ClipboardItem` write.** 0 and 0. The
  sibling that kept the legacy path duplicated it 5 times.
- **The non-secure-context path degrades correctly.** There are 0 `isSecureContext`
  checks and 0 `navigator.clipboard?.` guards, and that is fine: executed with
  `navigator.clipboard === undefined`, `copyText` catches the synchronous `TypeError`
  inside its own `try` and resolves `false` without throwing. The guard is unnecessary
  because the chokepoint already owns it — which is the chokepoint earning its keep.
- **The empty-string guard works.** Executed: `<CopyButton text="" />` clicked →
  `writeText` called **0** times, no flash.
- **Both hooks are unmount-safe.** `useCopyToClipboard.ts:31-38` and
  `useKeyedCopyFlag.ts:24-31` clear the pending reset timer on unmount. (The sibling's
  `OnboardCommand.tsx:67` does not, and can `setState` after unmount.)
- **Reduced motion is honoured.** `CopyButton.tsx:55-56` collapses both the flash and
  the morph to `duration: 0` under `useMotion()`. The *confirmation* still happens; only
  the animation is dropped — which is the correct reading of the preference.
- **No copy path double-announces.** `toasts.md` found every toast announced twice
  (`toastStore.ts:138` + the container's own `role="status"`). Copy sites are not
  affected, for the unhappy reason that they announce **zero** times.

---

## 8 Gaps in the primitives

1. **`copyText` returns a value the language cannot force you to read.** This is the
   root of D1, D9 and half of D4. TypeScript has no `#[must_use]`; `no-floating-promises`
   does not help because the promise *is* awaited. 32 of 36 direct callers discard the
   boolean, which is not 32 careless authors — it is a signature that made discarding
   the path of least resistance. **The primitive should own the outcome rather than
   report it** (§9).

2. **Nothing in the copy stack can announce.** `CopyButton`, `useCopyToClipboard`,
   `useKeyedCopyFlag` and `copyText` are all announcement-free, and `AriaLiveProvider`
   sits one import away, unused by all four. This is a genuine gap and not laziness:
   there is no seam where a call site could add the announcement without duplicating
   the success/failure decision the primitive already made. **D3 is entirely downstream
   of it.**

3. **`CopyButton` has no failure state at all.** There is no `failed` prop, no error
   icon, no `onFailure`. The component can distinguish success from failure internally
   and has no vocabulary to express the second. That is why P4 currently has no
   compliant implementation anywhere in this repo — the sibling's
   `guide/blocks/CopyButton.tsx:52` (`"Copy failed — press Ctrl+C"`) is the shape this
   one is missing.

4. **Managed mode has no failure channel by construction.** `onCopy?: () => void`
   cannot report. Any managed call site that wants to be honest has to re-derive the
   whole `ok` discipline outside the primitive, and all 5 currently do not.

5. **`copyText` has no classification, so "may this be copied" is unanswerable at the
   chokepoint.** Inherited verbatim from
   [`secret-display-and-transfer.md`](./secret-display-and-transfer.md) Gap 2 and not
   re-litigated: a secret and a persona name are the same type. Recorded here because
   D8's ruling depends on it — a blob affordance can only be made safe by the payload
   side, never by this one.

6. **There is no clipboard *write* path in Rust, so history exclusion is unreachable.**
   Inherited from that path's Gap 3 and **re-confirmed**: 0 repo-wide references to any
   Clipboard-History exclusion API, no `@tauri-apps/plugin-clipboard-manager`, and
   `arboard` used for reads only. Every wipe this app performs is defeated by Win+V.

7. **There is no paste primitive.** 5 `navigator.clipboard.readText()` call sites
   (`FieldCaptureHelpers.tsx:83,:103`, `BundleImportDialog.tsx:166`,
   `BundleExportDialog.tsx:28`, `fleetTerminalManager.ts:235`) with no shared helper, no
   ESLint rule and no golden path. `readText()` *can* reject where `writeText` cannot,
   so the failure contract is the mirror image of everything above — which is precisely
   why it should not be folded into this leaf by analogy. It is a missing leaf, not a
   missing section.

---

## 9 The missing gate

### The condition, stack-free

> **A copy affordance decides what to tell the user without knowing whether the write
> succeeded — so the confirmation is causally downstream of the click rather than of
> the result.**

An adopting repo must re-derive its own proxy. The one below keys on this repo's *having
a chokepoint at all*; a codebase where every call site calls the browser API directly
wears the same condition in completely different markup and would score zero while the
condition is total. Both siblings are exactly that codebase: `personas-web` (11 raw
sites, 0 helpers) and `brainiac/console` (4 raw sites, 0 helpers) would each report a
clean **0** against this pattern. **In `personas-web` the condition is genuinely present
at 2 confirmed sites plus 4 silent-failure paths.** That is the portability test's
failure mode, stated in advance rather than discovered in six months: the proxy keys on
`copyText`, and `copyText` is a local noun.

### Prefer a type over a gate — answered explicitly

**Yes, twice, and neither type change is the one the neighbouring path proposes.**

`secret-display-and-transfer.md` §9 already owes `copyText(text, kind: 'public' |
'secret')` — a required *classification* parameter, for the payload question. That is
correct and this path does not duplicate it. The type changes this leaf needs are about
the **outcome**, not the payload:

**(a) Move the outcome from the return value to the primitive.** A returned boolean is a
value 32 of 36 callers can and do ignore, and no gate can make TypeScript refuse. So
stop asking callers to act on it:

```ts
// today — useCopyToClipboard.ts:11-19. The outcome is a value; acting on it is optional.
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (err) { silentCatch("copyToClipboard:writeText")(err); return false; }
}

// proposed — same signature, but the primitive now DELIVERS the outcome:
//   ok   → announceImperative(t.common.copied_to_clipboard, 'polite')
//   !ok  → announceImperative(t.common.copy_failed, 'assertive')
// The boolean stays for callers that want to branch; nobody has to remember any more.
```

This is the contract's *"prefer fixing the default over counting the callers"* in its
purest form: **one edit inside the chokepoint gives all 72 copy affordances — the 30
shared, the 42 hand-rolled, and the 32 direct callers — an announcement and a failure
signal, without one of them changing.** No ratchet moves a single one of them. It also
closes D3 and Gap 2 outright, and it works precisely *because* this repo has the
chokepoint the siblings lack — the strongest available argument that the chokepoint,
un-rediscovered though it is, was worth building.

**(b) Make the managed verdict a different type from the managed click.**

```ts
// today — CopyButton.tsx:14-15. "I was pressed" and "it worked" are the same value.
copied?: boolean;
onCopy?: () => void;

// proposed — the handler must report, and `void` stops type-checking.
onCopy?: () => Promise<boolean>;
```

5 managed call sites; all 5 are wrong today; all 5 become compile errors the day it
lands, and the compiler finds them. A **required** report is the load-bearing detail —
the contract's own measurement is that `FacetedDecisionTable`'s required `emptyTitle`
gets 3/3 real copy while its optional-prop siblings get 5 of 20 falling through to a
default. An optional `onCopyFailed?` would reproduce the `<Numeric>` failure exactly: a
green gate pointing at a primitive nobody configured. Precedent already in this repo:
`AsyncButton`'s returns-a-promise `onClick`.

**The type changes are the fix. The census rule below is the ratchet that stops the
number rising while they land.**

### The fifth failure mode, already live here

`custom/prefer-shared-clipboard` is a working example of the contract's *"gate that
points at a broken destination."* It fires correctly, it reports the truth, and by its
own lights the codebase is healthy — 2 raw writes in 4,830 files. What it cannot say is
that the destination it routes callers to is **silent to screen readers, silent on
failure, and hands back a boolean 89% of callers discard.** Its own docblock claims the
primitive *"already handles the 'copied!' feedback, error handling, and a11y"*
(`prefer-shared-clipboard.cjs:5-6`). Two of those three are false. Fixing the docblock
is not the fix; fixing the destination is.

### The proposed instrument

**Check first that this is not already gated — it is not, and the check was run rather
than assumed.** All 65 existing rules were executed and their hit sets intersected with
this one's. `native-title-tooltip` (`tooltip.md`) shares **10 files** and **0 lines** —
it keys on the `title` attribute of a lowercase element, this one on a call shape.
`bindingless-catch-on-io` shares 3 files, 0 lines. `live-region-born-with-its-message`
(`screen-reader-announcements.md`) shares **0 files**: its condition is a live region
that exists but is born with its text, mine is a copy result nothing observes.
`discarded-toast-copy` and `unsolicited-failure-as-toast` share 0 files.

**One honest exception, reported rather than rounded away:** exactly one *line*
co-occurs across the whole registry —
`LabVersionsTable.tsx:312`, where `host-locale-date-render` matches
`new Date().toLocaleDateString()` and this rule matches the `copyText` opening the same
line. Two different conditions, one line, no duplicate enforcement.

- **Signal:** a `copyText(` call in **statement position** — beginning its line, after
  optional `await` / `void` / `try {` — i.e. its `Promise<boolean>` bound to nothing,
  with a bounded lookahead that spares a `.then(cb)` whose callback declares a parameter.
- **Mechanism:** a `scripts/census/rules.json` entry, inheriting the runner's fail-loud
  guarantees (floor violation, zero-match, stale exclude, rise **and** silent drop all
  fatal).
- **Allowlist:** **none, deliberately.** The two primitives that legitimately call
  `copyText` (`useCopyToClipboard.ts:42`, `useKeyedCopyFlag.ts:35`) are excluded **by
  shape, not by path** — they write `.then((ok) => …)`, and the lookahead spares them.
  That is the proof the matcher discriminates on the condition rather than on the token:
  removing `ok` from either primitive's callback would make it match, which is exactly
  right. An `exclude` entry would have hidden that.
- **How it fails loudly if its own precondition is absent:** `floor: 4000` fails the run
  if fewer than 4,000 `.ts`/`.tsx` files are walked (`frontend.tsFiles` is 4,829), so a
  moved root reports "matcher broken" rather than green. A **positive control** ships
  alongside, pointed at the *compliant* form through the same anchors.

**Verified against the real tree before publishing.** Both rules were run through
`scripts/census/lib/engine.mjs` — the same code `npm run census` uses — from a scratch
registry under a filename unique to this composer, never by editing `rules.json`. The
patterns live in a file, never in bash argv, and contain no lookbehind of any length.

```json
{
  "id": "unverified-clipboard-write",
  "goldenPath": "docs/concepts/golden-paths/copy-to-clipboard.md",
  "title": "A clipboard write whose success/failure result is bound to nothing",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^[ \\t]*(?:try[ \\t]*\\{[ \\t]*)?(?:await[ \\t]+|void[ \\t]+)?copyText[ \\t]*\\((?![\\s\\S]{0,240}?\\)[\\s]*\\.[\\s]*then[ \\t]*\\(\\s*(?:async\\s*)?\\(?\\s*[A-Za-z_$])",
    "flags": "gm",
    "ignoreCommentLines": true,
    "description": "A `copyText(...)` call in STATEMENT position — it begins its line (after optional indentation, `await`, `void`, or an inline `try {`) — so the `Promise<boolean>` it returns is bound to nothing and the caller cannot distinguish a completed copy from a refused one. PROXY FOR the stack-free condition \"a copy affordance decides what to tell the user without knowing whether the write succeeded, so the confirmation is causally downstream of the click rather than of the result\". WHY THIS IS THE CONDITION AND NOT PEDANTRY, executed rather than reasoned: `copyText` (useCopyToClipboard.ts:11-19) catches internally and NEVER REJECTS. Run under Vitest+jsdom with navigator.clipboard.writeText stubbed to throw NotAllowedError, `copyText` did not throw and resolved `false`; with navigator.clipboard set to undefined (the non-secure-context case) it caught the synchronous TypeError and resolved `false`. Consequently `await copyText(x).then(f).catch(g)` runs f and NEVER g — measured handler order on failure is exactly [\"THEN-RAN\"] — so every try/catch and every .catch() written around a copyText call in this repo is UNREACHABLE code that reads as failure handling. 18 of the 32 matched sites go on to claim success (setCopied(true), addToast(...,'success'), or PrBridge's markDone() advancing a workflow checkpoint) on a clipboard that may be empty. LEGAL DESTINATIONS, all three of which this pattern leaves unmatched: (1) `<CopyButton text={...} />` — the component gates its flash on the resolved boolean (CopyButton.tsx:62-67 plus useCopyToClipboard.ts:42-47); (2) `useCopyToClipboard()` / `useKeyedCopyFlag()` — both write `.then((ok) => { if (!ok) return; ... })`; (3) a bound direct call, `const ok = await copyText(x); if (!ok) return;` (ChatMessageContent.tsx:70-74, DevInspector.tsx:45-46). NO EXCLUDE LIST BY DESIGN: the two primitives that legitimately call copyText are spared by the negative lookahead because their `.then` callbacks DECLARE a parameter — i.e. they are spared for reading the boolean, not for their filename. Deleting `ok` from either callback would make it match, which is the correct behaviour and is the proof the matcher keys on the condition rather than on a token. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE: a prefix-context classifier and a statement-shape scanner over the same corpus disagreed on exactly 4 sites, all four `.then(() => ...)` chains with a zero-arity callback; hand-adjudication ruled all 4 as DISCARDED (a zero-arity `.then` cannot read the boolean) and both implementations now agree at 32. PRECISION on the stated condition is 32/32 — every match is a call whose boolean is bound to nothing. Four of the 32 are clipboard WIPES rather than copies (BundleExportDialog.tsx:30,44 and FieldCaptureHelpers.tsx:105,113, all `copyText('')`); they are reported as true positives, not exempted, because not knowing whether a secret wipe landed is the same defect pointed the other way. PRECONDITION (must be re-derived per repo): this repo HAS a clipboard chokepoint named `copyText`, enforced by custom/prefer-shared-clipboard at eslint.config.js:109 — 2 production navigator.clipboard.writeText calls in 4,830 files. A repo without a chokepoint wears the identical condition on raw `navigator.clipboard.writeText(...)` calls and scores ZERO here while being fully affected: measured, personas-web has 11 raw write sites, 0 helpers, and 2 confirmed optimistic-success paths plus 4 silent-failure paths; brainiac/console has 4 raw sites and 0 helpers. Such a repo should re-key this signal on its own raw API call in statement position. Do NOT silence a match by adding a try/catch — that is the defect, not the fix; bind the result, or take the type change in the golden path's §9."
  },
  "baseline": { "files": 22, "matches": 32 },
  "floor": 4000
}
```

```json
{
  "id": "unverified-clipboard-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/copy-to-clipboard.md",
  "title": "POSITIVE CONTROL — the COMPLIANT copy shape must remain reachable and matchable from these roots",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:=|\\bif[ \\t]*\\(\\s*!?)[ \\t]*await[ \\t]+copyText[ \\t]*\\(|copyText[ \\t]*\\([^;]{0,160}?\\)[\\s]*\\.[\\s]*then[ \\t]*\\(\\s*(?:async\\s*)?\\(?\\s*[A-Za-z_$]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for `unverified-clipboard-write`. It matches the COMPLIANT form through the SAME roots and extensions as its sibling — a copyText call whose boolean IS bound, either by assignment/condition (`const ok = await copyText(...)`, `if (await copyText(...))`) or by a `.then(cb)` whose callback declares a parameter. It is not a violation count and must never be baselined or ratcheted. Its job is to prove the matcher DISCRIMINATES ON SHAPE rather than on the token `copyText`: if the sibling rule ever reports zero, this control distinguishes 'the migration finished' from 'the walk broke' or 'someone renamed the primitive'. Measured 2026-08-14: 4 files / 4 matches (ChatMessageContent.tsx:70, DevInspector.tsx:45, useCopyToClipboard.ts:42, useKeyedCopyFlag.ts:35), 608ms over 4,830 walked files. Its match population is DISJOINT from the sibling's 32 — 0 files and 0 lines in common — which is the strongest available evidence that the two patterns partition the same call population by the property that matters (is the result read?) rather than overlapping on the name. Deliberately shipped with NO `baseline` key so merge-published-rules.mjs skips it and assertRule short-circuits before any drift check."
  },
  "floor": 4000
}
```

**Measured populations and overlap**

| Rule | Files | Matches | Runtime | Overlap with the other |
|---|---:|---:|---:|---|
| `unverified-clipboard-write` | 22 | 32 | 748 ms | **0 files, 0 lines** |
| `unverified-clipboard-write-positive-control` | 4 | 4 | 608 ms | **0 files, 0 lines** |

The 22 violating files: `PrBridge.tsx` (×4), `BundleExportDialog.tsx` (×4),
`FieldCaptureHelpers.tsx` (×3), `CreatedKeyDialog.tsx` (×2), `TablesTab.tsx` (×2), and
one each in `PersonaOverviewCardList.tsx`, `DryRunModal.tsx`, `ExecutionLogViewer.tsx`,
`ExportReportButton.tsx`, `LabVersionsTable.tsx`, `CreativeStudioPanel.tsx`,
`Gallery2D.tsx`, `DriveDetailsPane.tsx`, `DrivePage.tsx`, `DriveOcrDrawer.tsx`,
`DriveSignaturesPanel.tsx`, `DriveSignDialog.tsx`, `FleetPairDevice.tsx`,
`TwinWikiPanel.tsx`, `RecipeEditor.tsx`, `McpServerInfoPanel.tsx`,
`CliConnectionPanel.tsx`. The control's four files are the two compliant call sites and
the two primitives.

### Three conditions this leaf will not gate, and why refusing is the right answer

**Refusing to gate is first-class — with measurement.** All three refusals carry counts,
and each names the instrument that *would* work.

1. **"A copy affordance is announced to assistive technology."** This is D3, the
   condition with the widest blast radius in the leaf (**0 of 72**), and it is a
   **must-be-zero-violations** condition — i.e. it wants to assert that a thing is
   *present* everywhere. **The census engine cannot express it.** `assertRule` raises a
   structural `zero-matches` failure for any rule matching nothing
   (`engine.mjs:264-273`, whose own message says a rule pinned at 0 *"is a gate that can
   never fail"*), so a rule counting *missing* announcements would have to be baselined
   at 72 today and at 0 on the day it is fixed — and 0 is fatal. The correct instrument
   is not a count at all: it is **the type change in (a) above**, which makes the
   announcement structural, plus the Vitest probe this composition already wrote — render
   `CopyButton`, click it, assert a `role="status"` node in the document contains the
   copied message. That test fails the moment someone removes the announcement, which no
   count can do.

2. **"A copy button ships one tooltip, not two."** Already gated, elsewhere.
   `native-title-tooltip` (571 files / 1,108 matches) contains `CopyButton.tsx:76`
   today. Adding a second rule would be duplicate enforcement of one condition and
   would give the double-tooltip defect two baselines to drift against. Deferred to
   `tooltip.md` in full — including the warning that the naive fix removes the only
   accessible name an icon-only instance has.

3. **"What lands on the clipboard is what the user sees."** This is D5 and D7, and it is
   **not gateable by counting.** The signal would have to be "this `text=` expression and
   that render expression are the same value", which is a cross-expression provenance
   question no regex and no single-file AST rule can answer:
   `<CopyButton text={maskSensitiveJson(x)} />` and `<CopyButton text={x} />` are the
   same shape, and only one of them is wrong. Counting `<CopyButton` instead would fire
   on all **30** render sites of which 1 is the defect — a **3%** precision gate that
   fires overwhelmingly on correct content, which the contract rates as **worse than no
   gate**. The instrument that does work is a code-review question in §4 step 2, and the
   payload classification `secret-display-and-transfer.md` already owes.

### One more thing a gate cannot see

The census rule counts *call shapes*. It cannot see that 42 buttons were hand-rolled
(no `copyText` in most of them — they call the hooks), that two components shadow the
primitive's name, that `UuidLabel`'s button is transparent under keyboard focus, or that
37 i18n keys spell four words. Those are D2, D6 and D7, and they were found by reading
components and by **running** the primitive — which is what §4 step 3 and step 9 exist to
prevent in the first place.
