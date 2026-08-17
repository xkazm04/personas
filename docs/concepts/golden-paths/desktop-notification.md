# Golden path — Desktop notification

> Situation node: `ui-system/chrome-and-feedback/desktop-notification` ·
> [situation spine](../situation-spine.md) · recurrence 11 · risk **medium** ·
> sides: **client** · convergence: **mixed** ·
> dimensions: **function · ui · resilience** ·
> **`twoSided: true`** · merged from *"OS notifications"* +
> *"Background completion notification"* + *"State-change desktop notification"*.
> Composed 2026-08-17 against `master` @ `313dc6a84`.
>
> **Sweep size.** 4,801 `.ts`/`.tsx` files and 564 `.rs` files walked, each by
> two independent implementations — one built on
> `scripts/census/lib/instruments/{stripComments,stripCfgTest}`, one bespoke —
> enumerating **57 OS-notification delivery sites** across **five distinct
> doors** (three TypeScript mechanisms, one IPC command, one Rust module). Full
> reads of `lib/notifications/notifyProcessComplete.ts`,
> `lib/notifications/notifyFleetAwaiting.ts`,
> `lib/utils/platform/osNotification.ts`, `api/system/system.ts`,
> `stores/notificationCenterStore.ts`, `src-tauri/src/notifications.rs`
> (1,590 lines), `src-tauri/capabilities/{default,mobile}.json`,
> `lib/harness/verifier.ts`, and every one of the 26 frontend delivery sites
> opened by hand. All 31 Rust send sites classified by title shape. A five-repo
> convergence sweep (`../personas-web`, `../brainiac`, `../personas-cloud`,
> `../vibeman`, `../ascent`) returned a **five-way zero** (§10).
> `cargo` was not run (unavailable) — the Rust is read, not built. The full
> census registry was **not** run; only this path's two rules were validated, in
> a private registry.

---

## 0. The headline: 52 of 57 OS notifications are hardcoded English, and the half that cannot be fixed is the half the spine says does not exist

This app ships in **14 languages** and enforces translation completeness at
commit time (`lefthook.yml`'s `i18n-no-gaps` job; 19,112 keys × 13 locales at
0 missing). None of that reaches a desktop notification.

| door | mechanism | sites | English-only |
| --- | --- | ---: | ---: |
| `crate::notifications::send` | Rust → `tauri_plugin_notification` | **31** | **31** |
| `sendAppNotification` | IPC → the same Rust `send` | 16 | 14 |
| `sendOsNotification` | **Web `Notification` API**, no plugin | 6 | 6 |
| `sendNotification` (direct) | `@tauri-apps/plugin-notification` | 2 | 1 |
| `notifyFleetAwaiting` / `notifyProcessComplete` | plugin, via helpers | 2 | 0 |
| **total** | | **57** | **52 (91.2%)** |

The **31 Rust sites are not fixable where they are.** `src-tauri/src/notifications.rs`
contains zero matches for `locale`, `i18n` or `translat` — there is no locale on
the Rust side to route through, and the strings are literals in the call
(`"Task Failed"`, `"Context Scan Failed"`, `"Credential needs re-authorization"`)
or `format!` templates with English skeletons (`"Athena · {} — goal shelved"`).
24 of 31 are bare literals; the other 7 are computed and every one of the 7 is
computed *from* an English template.

That is the leaf's shape in one line: **the notification text is composed on the
side of the IPC boundary that has never heard of the user's language, and it
leaves the app into an OS surface nothing can re-render.** A toast can be fixed
by a re-render. A notification cannot: once `show()` returns, the string is in
Windows Action Center.

Three more findings frame the rest.

**Five doors for one concept, and one of them is not the Tauri plugin at all.**
`lib/utils/platform/osNotification.ts` uses the browser's `Notification`
constructor directly. Its docstring says *"Works in Tauri's WebView -- no plugin
required."* It therefore also requires **no capability**: `capabilities/default.json:13-16`
allowlists `notification:default`, `allow-is-permission-granted`,
`allow-request-permission` and `allow-notify` for the plugin, and this door
bypasses that allowlist by construction. It has **three silent `return`
statements and zero error doors** (`:18`, `:21`, `:23`), and **all 6 of its call
sites discard the promise with `void`** — so a notification that is never
delivered is indistinguishable, at every layer, from one that is.

**The one door that gets everything right has exactly one caller.**
`notifyProcessComplete` (`lib/notifications/notifyProcessComplete.ts`) requests
permission lazily at send time, wraps the OS attempt in a `try`, and — the part
worth copying — **writes the in-app Notification Center entry unconditionally,
outside the `try`** (`:66-74`), so the record survives a denied, missing or
crashed OS layer. It declares 14 process types (`:13-28`). It is called from
**one** site (`teams/sub_assignments/useAssignmentNotificationDispatcher.ts:52`)
with **two** of them. The repo's own coverage gate for this helper is a
`grep … | wc -l` that counts its own prose (§7 D6).

**And `sides: "client"` is inverted.** 31 of the 57 delivery sites are Rust;
the *largest* and *least fixable* half of this leaf is on the server. The spine
marks the node `twoSided: true` in the same object, so the contradiction is
internal (§12.5).

---

## 1. Trigger

1. "Tell the user when this finishes, even if the window isn't focused."
2. "The scan takes four minutes — they'll go do something else."
3. "This just went to `failed` / `awaiting_input` / `needs re-authorization`."
4. "Ping them on their desktop." / "a toast, but outside the app"
5. **The "about to write X" test:** you are about to type `new Notification(`,
   `sendNotification({`, `sendAppNotification(`, `requestPermission()`, or
   `crate::notifications::send(app, "`. Every one of those is this leaf, and
   four of the five are the wrong door.

## 2. The one way

**Compose the text where the locale lives, deliver through one door, and always
write the durable in-app record first.** Concretely: resolve the title and body
from `useTranslation()` (in a component) or `getActiveTranslations()` (in a
store, hook or non-React module) **at the moment of delivery**, never from a
module-scope `en` snapshot and never as a literal; then call
`notifyProcessComplete({ processType, success, summary, redirectSection }, t)`
and stop — it requests permission lazily on first use, swallows an OS failure
without letting it reach your caller, and records the event in the Notification
Center **outside** the `try`, so the user still finds it in the title-bar bell
when the OS refuses. Do not request permission on mount, on startup, or anywhere
except immediately before a notification the user has already asked for by
starting the work. Do not add a second door: `sendOsNotification` (the raw Web
API), a bare `sendNotification` and a bare `sendAppNotification` all exist and
all three drop failures silently. **If the event originates in Rust, do not
notify from Rust and from the frontend** — pick one authority and say so in a
comment the way `useContextScanBackground.ts:73-79` does, because the backend
fires even when no UI is mounted and the double-notify is the default outcome.
And treat any notification body that says "Click to…" as a bug until §8 G1 is
closed: **no door in this app routes a notification click anywhere.**

## 3. Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `@/lib/notifications/notifyProcessComplete` → `notifyProcessComplete(opts, t)` | lazy permission + OS send + **unconditional** Notification Center record with a `redirectSection`/`redirectTab` deep link |
| its `ProcessType` union (`notifyProcessComplete.ts:13-28`) | 14 declared process kinds, each bound to a `process_labels.*` i18n key |
| `getProcessLabel(processType, t)` | the label, resolved live at render — pass `t`, always (§7 D4) |
| `@/stores/notificationCenterStore` → `addProcessNotification` | the durable record; persists 50 entries to `localStorage`, drives the title-bar bell |
| `useTranslation()` / `getActiveTranslations()` | the locale at delivery time. `import { en }` is a **module-init snapshot** and is the wrong source here |
| `@/lib/silentCatch` → `silentCatch(tag)` / `toastCatch` | the error doors. A notification failure is background — `silentCatch` — but it must reach one |
| `src-tauri/src/notifications.rs` → `send(&app, title, body)` | the Rust door. `pub(crate)`, logs `tracing::warn!` on failure, returns `()` |
| `NotificationPrefs` (`notifications.rs:16-26`) | the per-persona opt-out gate: `execution_completed` / `manual_review` / `new_message` / `healing_issue` |
| `capabilities/{default,mobile}.json:13-16` | the four plugin permissions. If your door does not appear here, it is not the plugin door |

**Do not invent a name.** There is no `notify()`, no `useNotification()` hook,
no notification queue, and no click-action registry. `requestNotificationPermission()`
exists (`osNotification.ts:9-14`) and has **zero callers** — do not become its
first.

## 4. Steps

1. **Decide whether this is a notification at all.** It is, only if the user has
   left: a long job finishing, an entity going terminal, something needing a
   human. Everything else is a toast (`addToast`) or a Notification Center entry
   with no OS half.
2. **Decide which side owns it.** If the work runs in Rust and can finish with
   no UI mounted (a scan, a scheduler tick, an overnight run), Rust owns it —
   and the frontend listener must then say in a comment that it deliberately
   does *not* notify. `useContextScanBackground.ts:73-79` is the model.
3. **Resolve the strings from the live locale**, in the same tick as the send.
   In a component: `const { t, tx } = useTranslation()`. Outside React:
   `getActiveTranslations()`. Add the keys to `src/i18n/locales/en.json` and
   translate all 13 locales in the same change — the `i18n-no-gaps` pre-commit
   hook will block you otherwise.
4. **Call `notifyProcessComplete({...}, t)`.** Pass `t`. The parameter defaults
   to the `en` snapshot and the default is silent (§7 D4).
5. **And then stop.** Do not check permission yourself, do not branch on
   `Notification.permission`, do not add a `catch` — the helper owns all three,
   and the in-app record is already outside its `try`.
6. **If you must use a lower door** (`sendAppNotification` for a Rust-composed
   body, or the plugin directly), you now own three things the helper was doing:
   the in-app record, the error door, and the locale. Write all three.

### Can the primitive's signature make the wrong call impossible?

Asked before §9, and here the answer is the strongest kind — **withhold the
dangerous value** (doctrine Q5), because the dangerous value *is* the string:

- **`sendAppNotification(title: string, body: string)` hands the caller total
  freedom over the text**, and 14 of its 16 callers used that freedom to write
  English. Replacing it with a key-shaped door —
  `notifyOs(key: NotificationKey, params?: Record<string, string|number>)`,
  resolving through `getActiveTranslations()` inside — makes an untranslated
  notification **unspellable**, and it is the same edit the contract already
  records for `<Numeric>`: fixing the primitive's default corrected ~212 call
  sites where no ratchet moved one.
- **`notifyProcessComplete(opts, t: Translations = en)` is the `<Numeric>`
  defect verbatim** — an optional locale parameter defaulting to English. But
  note **Q3**: it has *one* caller, and that caller passes `t`. A type nobody
  constructs constrains nothing; making `t` required here would change one line
  and prevent nothing. The leverage is entirely on `sendAppNotification`, which
  has 16.
- **Q5 does not reach Rust.** Withholding the string from a Rust caller requires
  a locale for it to resolve against, and there is none. See §8 G3 — this is the
  gap the whole backend half sits on.
- **`send_app_notification` returning `()` is a withholding failure in the other
  direction.** It withholds the *result*: `#[tauri::command] pub fn send_app_notification(...)`
  (`notifications.rs:1161-1163`) has no `Result`, `send` logs and drops
  (`:1543-1547`), and the TS wrapper is `invoke<void>` (`api/system/system.ts:113`).
  A denied notification and a delivered one are the same value at every layer.
  Widening the return to `Result<(), AppError>` is type-widening, but it changes
  what 16 call sites must handle — deferred (§9).

## 5. Anti-patterns

**A. `new Notification(...)`, or anything that reaches it.** Six call sites go
through `sendOsNotification`. Failure modes, all three at once: it bypasses the
Tauri capability allowlist; it returns on three separate conditions with no
telemetry; and its callers `void` the promise, so the *one* thing it does report
(a rejected `requestPermission`) is discarded too.

**B. Requesting permission on mount.** `usePipelineNotifications.ts:86-99` asks
on the hook's first render, guarded by `permissionCheckedRef`, before any
pipeline has finished. The OS prompt therefore appears for a user who has not
yet asked for anything — the highest-refusal-rate moment there is. Worse, the
result is cached in `permissionGrantedRef` and **never re-read**: a user who
grants permission afterwards gets nothing until the hook remounts.

**C. Hardcoding the text.** 52 of 57 sites. It is invisible to every gate the
repo has: `custom/no-hardcoded-jsx-text` is JSX-only and warn-level, and every
one of the six offending frontend files is a `.ts`, not a `.tsx`, so the rule
never even parses a JSX element there.

**D. Writing "Click to review." in the body.**
`useAdoptionCompletionNotifier.ts:82` says *"has been built. Click to review."*,
`:88` says *"Click to see details."* **No door in this app routes a
notification click.** The only click handler anywhere is
`osNotification.ts:25-27`, `notif.onclick = () => window.focus()` — which
raises the window and lands the user wherever they left it. The copy promises
navigation the code does not implement, on the one door where a click is even
observed.

**E. Notifying from both sides of the IPC boundary for one event.** The default
outcome, because the Rust side fires unconditionally and the frontend listener
looks like the natural place. `useContextScanBackground.ts:73-79` is the file
that discovered this and wrote it down; nothing enforces it.

**F. `if (permitted) send(...)` with no else.** Present at 4 of 5 doors. A
denied notification is a *product* event — the user has asked not to be
interrupted — and the correct response is the in-app record, not nothing.
`notifyProcessComplete` is the only helper that gets this right, and it gets it
right by putting the record **outside** the `try` rather than in a `catch`.

**G. A coverage gate built from `grep | wc -l`.** See D6. The pipe replaces the
exit code, `required: false` makes it advisory, and the pattern counts the
gate's own source.

## 6. Evidence

**The one site to copy: `src/lib/notifications/notifyProcessComplete.ts`.**
40 lines. Read `:53-74` as a unit — the OS attempt is fully enclosed in a `try`
whose `catch` reaches `silentCatch`, and the durable record follows it
unconditionally. That ordering is the entire resilience story of this leaf, and
it is four lines of code.

Other exemplary sites, each for one clause:

- `features/plugins/dev-tools/hooks/useContextScanBackground.ts:29-46` — the
  **best composed notification in the repo**: `const dt = t.plugins.dev_tools;`
  read from `useTranslation()` inside the callback, permission requested lazily,
  title and body both `tx()`-interpolated, the whole thing in a `try` with a
  tagged `silentCatch`. Copy this shape when you must use the plugin directly.
- The same file, `:73-79` — the **double-notify rule**, written down: *"We
  intentionally do NOT fire an OS notification from here: the backend already
  sends one authoritatively (`crate::notifications::send`, fired even when no Dev
  Tools UI is mounted), so calling notifyCompletion here would double-notify."*
- `features/agents/sub_health/useHealthDigestScheduler.ts:100-116` — a
  **scheduled** notification composed entirely from `interpolate(notif.*)` keys
  at fire time, including plural variants. This is the answer to "does a
  scheduled notification carry a stale locale": composed late, it does not.
- `features/plugins/fleet/sub_grid/FleetGridPage.tsx:222-228` — `tx()` with a
  detail/no-detail branch, both localized.
- `src-tauri/src/notifications.rs:16-26` + the `NotificationPrefs` gate — the
  per-persona opt-out. The Rust half is not thoughtless; it is *locale-less*,
  which is a different thing.

## 7. Deviations

### D1 — 52 of 57 delivery sites are hardcoded English; 31 of them cannot be fixed in place

Counts in §0. The 21 frontend English sites, in full:
`useLifecycle.ts:170,177,298,302,332` · `useBackgroundRebuild.ts:59,71,77,90` ·
`useAdoptionCompletionNotifier.ts:82,88,92` ·
`remediationExecutor.ts:27,54,70` · `useBackgroundPreview.ts:47,50` ·
`useLabEvents.ts:31,33` · `backgroundChatSlice.ts:444,459` ·
`usePipelineNotifications.ts:133-134`. The 5 clean sites:
`useConnectorStatuses.ts:200` · `useHealthDigestScheduler.ts:116` ·
`FleetGridPage.tsx:222` · `useAssignmentNotificationDispatcher.ts:52` ·
`useContextScanBackground.ts:38`. P1.

### D2 — a fifth door that is not the plugin, has no capability, and cannot report failure

`lib/utils/platform/osNotification.ts`. Six callers
(`useAdoptionCompletionNotifier.ts` ×3, `remediationExecutor.ts` ×3), **all six
using `void`**. Three exits with no telemetry:

```ts
osNotification.ts:18   if (!('Notification' in window)) return;
osNotification.ts:21   if (result !== 'granted') return;
osNotification.ts:23   if (Notification.permission !== 'granted') return;
```

Two of the six are **security-relevant** — `remediationExecutor.ts:54`
("Credential Auto-Disabled") and `:70` (credential drift / critical) are the
user-facing half of the credential remediation bus, and they are the failure
class the doctrine names: *760 try/catch bodies reach no error door at all*.
These do not even have a `catch` to be counted in that figure; they have three
`return`s. P1.

### D3 — permission requested on mount, then cached forever

`usePipelineNotifications.ts:86-99`. See §5 B. P2.

### D4 — the locale is an optional parameter that defaults to English, twice

`notifyProcessComplete(opts, t: Translations = en)` (`:44`) and
`getProcessLabel(processType, t: Translations = en)` (`:31`). The contract
records this exact shape for `<Numeric>`, where 189 of 197 call sites forgot the
argument. Here both callers remember — `useAssignmentNotificationDispatcher.ts:52`
passes `t`, `NotificationCenter.tsx:79` passes `t` — so the defect has not fired
**yet**. It is listed because the sample size is 2 and the default is silent:
the third caller will be the one that omits it, and nothing will say so. P3, and
the fix is one character (`t: Translations` — deferred, it changes a public
signature).

### D5 — the durable record is half-live across a locale switch

`notificationCenterStore` persists up to 50 entries to `localStorage`
(`:56-75`), storing `title` and `message` as **resolved strings**
(`:154-155`). `NotificationCenter.tsx:79` re-resolves the *label* through
`getProcessLabel(processType, t)` at render — correctly live — but the body
beside it is whatever locale was active when the notification fired. Switch
language and the bell shows a translated label above an untranslated summary,
for up to 50 rows. This is the concrete form of "a notification composed earlier
carries the previous locale", and it lives in the **in-app** record, not in the
OS one. P2.

### D6 — the notification coverage gate counts its own source

```ts
lib/harness/verifier.ts:74-83
export function notificationCoverageGate(): VerificationGate {
  return { name: 'notification-coverage', type: 'custom', required: false,
    command: 'grep -rn "notifyProcessComplete" src/ --include="*.ts" --include="*.tsx" | wc -l' };
}
```

Four independent failures. The pipe to `wc -l` replaces `grep`'s exit code with
the pipe's, so it can never fail. `required: false` makes it advisory anyway.
The pattern counts **prose**: 8 of the 13 current matches are feature-list
strings inside `lib/harness/scenario-parser.ts:359-415`, one is this gate's own
`command` string, one is the helper's `export function` line, one is an import
in `NotificationCenter.tsx` — leaving **1 real call site out of 13 matches**.
And because two of the counted mentions are in the gate's own file, the number
**cannot reach zero** even if every caller is deleted. A gate that manufactures
confidence, in the contract's precise sense. P2.

### D7 — 12 of 14 declared process types never reach the door that declares them

`PROCESS_LABEL_KEYS` (`notifyProcessComplete.ts:13-28`) binds 14 `ProcessType`s
to `process_labels.*` keys. `notifyProcessComplete` is called once, with
`team-assignment-failed` and `team-assignment-unmatched`. The other twelve —
`n8n-transform`, `template-adopt`, `rebuild`, `template-test`, `context-scan`,
`idea-scan`, `execution`, `matrix-build`, `lab-run`, `connector-test`,
`creative-session`, `feedback-chat` — **do** get notified, by four other doors
that do not consult this map. The map's i18n keys are still reachable through
`getProcessLabel` from the Notification Center, so this is drift rather than
dead code; but the helper the harness calls "reusable" is used by 1 of the 13
processes it names. P2.

### D8 — a notification body promises a click that no door routes

`useAdoptionCompletionNotifier.ts:82` ("Click to review."), `:88` ("Click to see
details."). The only handler in 4,801 files is `window.focus()`
(`osNotification.ts:25-27`); the plugin door and the Rust door register no
`onAction` and no `registerActionTypes` anywhere. Meanwhile the *in-app* record
does deep-link (`notificationCenterStore.ts:151`, `webUrl` from
`redirectSection`/`redirectTab`) — so the app has the routing and the OS
notification is the one surface that cannot use it. P2.

### D9 — the in-app fallback exists at 3 doors of 6

Present and correct: `notifyProcessComplete` (`:66-74`, outside the `try`),
`usePipelineNotifications` (`:122-128`, with a comment saying *"always,
regardless of OS permission"*), `backgroundChatSlice` (`:446-456`, with a
docstring saying the bell entry is *"the persistent record the user can come
back to"*). Absent: `notifyFleetAwaiting`, `sendOsNotification`,
`crate::notifications::send`. Three engineers independently wrote the right
answer and it never became the door. P1 — and it is what §2 exists to fix.

### D10 — `requestNotificationPermission()` has zero callers

`osNotification.ts:9-14`, exported, never imported. Its whole purpose is the
proactive request §5 B warns against; the correct outcome is deletion, and it is
the one change in this document that is safe to make (a zero-consumer helper
whose signature is the defect). Left as a note only because it shares a file with
six live call sites. P3.

## 8. Gaps — what the primitives genuinely cannot do

**G1. Nothing can route a notification click.** `tauri-plugin-notification`
supports action types and a click channel; this app registers neither, on either
side. The Web-API door observes a click and can only `window.focus()`. Until
this closes, D8's copy is unfixable except by rewording. This is upstream of one
deviation and of every "so what do I do when they click it" question a future
author will ask.

**G2. There is no way to know a notification was not delivered.** The Rust
`send` logs and returns `()` (`:1543-1547`); the command returns `()`; the TS
wrapper is `invoke<void>`. Nothing above the `tracing::warn!` can branch on
failure, so nothing can fall back. The in-app record works today *because* it is
unconditional, not because anyone can detect the OS refusing.

**G3. The Rust side has no locale.** Zero matches for `locale` / `i18n` /
`translat` in `notifications.rs`. The 31 backend sites cannot be localized where
they are; the fix has to move composition to the frontend (emit an event with a
key + params and let the listener resolve it) or teach Rust a locale. **This is
the single largest structural gap in this leaf**, and it explains why the census
rule in §9 covers only the frontend.

**G4. `Notification` in a WebView is not the same guarantee as the plugin.**
`osNotification.ts`'s docstring asserts *"Works in Tauri's WebView -- no plugin
required."* Nothing in the repo verifies that claim on any platform, no test
covers it, and its three silent returns mean a platform where the constructor is
inert would look identical to one where it works. Not asserted here as broken —
asserted as **unverified**, which for six live call sites including two
credential alerts is the finding.

**G5. There is no notification queue, dedupe, or rate limit for the OS door.**
`notifications.rs` has a per-channel test-delivery rate limiter
(`TEST_DELIVERY_RATE_LIMIT`, `:1168-1173`) for the *external* channels; the OS
door has none. Dedupe is hand-rolled per caller (`notifiedRef` sets in
`useAdoptionCompletionNotifier`, `useAssignmentNotificationDispatcher`,
`FleetGridPage`) — three copies of one mechanism.

## 9. The missing gate

### What would have caught this

Not `custom/no-hardcoded-jsx-text`: it is JSX-only *and* warn-level, and all six
offending frontend files are `.ts`. Not the harness gate: D6. The condition is
*"user-facing text leaves the app through a channel nothing can re-render, in a
language the user did not choose"*, and the proxy that survives here is **a
notification door called with a leading string literal**.

State the proxy for the next repo: it is keyed on this repo's *door names*, not
on a semantic notion of "notification". A codebase whose door is
`notify(...)`, `toast.system(...)` or `push()` must re-derive the same shape
against its own vocabulary — and, per the doctrine's warning about
vocabulary-based signals, **derive that list from the tree, not from
imagination**. The list below came from enumerating every import of
`@tauri-apps/plugin-notification` and every consumer of `send_app_notification`
first.

### The rule

```json
{
  "id": "english-literal-os-notification",
  "goldenPath": "docs/concepts/golden-paths/desktop-notification.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:sendAppNotification|sendOsNotification|notifyFleetAwaiting)\\s*\\(\\s*(?:[A-Za-z_$][\\w$.]{0,40}\\s*\\?\\s*)?['\"`][A-Z]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An OS-notification door called with an English string literal as its title. The text leaves the app into the OS notification centre, where nothing can re-render it — so a literal here is permanently untranslated for 13 of 14 locales."
  },
  "exclude": [
    { "path": "**/__tests__/**", "reason": "unit-test fixtures — a literal title in a test asserts the IPC wrapper resolves, it is not a user-facing notification" },
    { "path": "**/*.test.ts", "reason": "unit-test fixtures — a literal title in a test asserts the IPC wrapper resolves, it is not a user-facing notification" }
  ],
  "baseline": { "files": 6, "matches": 18 },
  "floor": 4000
}
```

```json
{
  "id": "english-literal-os-notification-positive-control",
  "goldenPath": "docs/concepts/golden-paths/desktop-notification.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:sendAppNotification|sendOsNotification|notifyFleetAwaiting)\\s*\\(\\s*(?:[a-z_$][\\w$]{0,20}\\.)?(?:t|s|dt|notif)\\.",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the same three doors called with an i18n-resolved title (`t.…`, `dt.…`, `notif.…`)."
  },
  "floor": 4000
}
```

**Validated** in a private registry at `313dc6a84`: rule **6 files / 18
matches**, control **2 files / 2 matches**, 4,801 files walked against a floor of
4,000.

**The anchor partitions.** A third throwaway rule counted every call to the
three doors: **26 matches in 13 files.** Two are the helpers' own `export
function` lines, one is the excluded test. The remaining **23 real call sites
divide 18 violating / 2 compliant / 3 indirect** — and hand-inspection puts two
of the three indirect ones (`remediationExecutor.ts:70`, a title variable built
from English literals at `:66-68`; `backgroundChatSlice.ts:135`, a local wrapper
whose two callers at `:444`/`:459` build English template strings) on the
violating side and one (`useHealthDigestScheduler.ts:116`, `interpolate(notif.*)`)
on the compliant side. **20 violating / 3 compliant of 23.**

**Hand-verified precision: 18/18.** Every match opened: `useLifecycle.ts` ×5
(`'Agent Test Passed'`, `'Agent Test Failed'`, `'Agent Promoted — needs setup'`,
`'Agent Promoted'` ×2), `useBackgroundRebuild.ts` ×4, `useAdoptionCompletionNotifier.ts`
×3, `remediationExecutor.ts` ×2, `useBackgroundPreview.ts` ×2, `useLabEvents.ts`
×2. All are English titles delivered to the OS.

**Hand-verified recall: 18/22 (81.8%).** Four known misses, each for a named
structural reason: `remediationExecutor.ts:70` (title is a variable),
`backgroundChatSlice.ts:444`/`:459` (a local wrapper indirects the door), and
`usePipelineNotifications.ts:133` (the plugin's object-literal form,
`sendNotification({ title: … })`, which is a different door). Widening the
pattern to reach the object form would pull in `notifyProcessComplete`'s own
internals; the honest scope is the three named doors.

**Fail-loud.** Inherited: `floor: 4000` fails if the walk under-collects; a
zero-match run fails structurally; a silent drop fails; the two `exclude`
entries fail if they stop matching. One drop cause to name in advance:
**`useLifecycle.ts` alone is 5 of the 18 matches (27.8%)**, so deleting or
refactoring the agent-matrix lifecycle moves this baseline as far as a real fix
would. Say which, per the runbook.

### Declined: a Rust rule

The obvious sibling — `crate::notifications::send\s*\(\s*[^,]+,\s*"` — would
match **24 of 31** sites at 100% precision. It is declined, and the reason is
the finding: **the census ratchets a count toward a compliant form, and there is
no compliant form to ratchet toward.** Rust has no locale (G3), so every one of
the 24 would sit at its baseline forever, and the 7 `format!`-computed titles
are equally English while being invisible to the pattern — a rule that reports
77% of a condition it cannot help anyone fix. The correct instrument is the
architectural change in G3, not a number. Recorded here so the next composer
does not re-derive the rule and ship it.

### Declined: a permission-timing rule

`requestPermission()` inside a `useEffect` with an empty dependency array is the
D3 condition, and it has **one** instance. A census rule that matches a single
site is a rule about one file; the fix is to change that file. Declined on
population size.

## 10. Convergence — a five-way zero, and the `mixed` label fails

| repo | sends OS notifications | detail |
| --- | --- | --- |
| `personas-web` | **no** | `public/sw.js` is a self-unregistering tombstone; no `push`, no `notificationclick`, no `showNotification` |
| `brainiac` | **no** | zero in the Next.js console and in the Rust crates |
| `personas-cloud` | **no** | no browser, no Tauri, no push library in any of 3 packages |
| `vibeman` | **no** | **a Tauri app with the capability available and the plugin absent** |
| `ascent` | **no** | "notify" throughout means **email** (`api/scan/stream/route.ts:216-219`) |

Zero matches, in all five repos, for `new Notification(`,
`Notification.requestPermission`, `isPermissionGranted`,
`@tauri-apps/plugin-notification`, `tauri-plugin-notification`,
`sendNotification`, `notify-rust`, `node-notifier`, `web-push`, and
`serviceWorker` + `showNotification`.

**`convergence: mixed` fails.** There is no mixture — there is silence. And the
direction is backwards in the mode
[`embedded-terminal-session`](./embedded-terminal-session.md) recorded: Personas
is the only repo in the cohort that *has* the situation, and it owns the fleet's
only answer to it. A label describing how the fleet's approaches compare cannot
apply where four of five repos have no approach.

**The one result worth more than the count is `vibeman`'s**, and it is
cost-shaped rather than agreement-shaped — the strongest evidence class the
doctrine recognises. `vibeman` is a Tauri desktop app; its `src-tauri/Cargo.toml`
has neither `tauri-plugin-notification` nor `notify-rust` (the `notify = "7"` on
line 31 is the filesystem watcher), and its `package.json` has no
`@tauri-apps/plugin-notification`. Everything named "notification" there is a
SQLite row (`commands/conductor_cmds.rs:124`, `scanNotification.repository.ts:12`,
5 fire sites in `scanQueueWorker.ts`). **The intent existed and was dropped**:
`.planning/phases/04-notifications/04-RESEARCH.md:161,194` still documents
`requestPermissions()`, and `lib/polling/README.md:594` shows a
`showNotification('Connection issues detected')` example — neither implemented.
So a long scan finishes and the user is told only if the app is open and they
happen to be looking at that panel. Given the established lineage (`vibeman`
predates Personas), the honest reading is that Personas built the thing its
ancestor planned and abandoned — which makes the five-door sprawl in §0 the
price of having actually shipped it, not evidence of carelessness.

`ascent`'s analogue is worth one line for the *shape* rather than the mechanism:
its no-provider path is a deliberate **silent-but-logged** noop
(`lib/email/noop.ts:5`, *"It LOGS the would-be send and never throws"*). That is
the correct instinct for D2's three silent returns — log, do not throw — and it
is what `sendOsNotification` omits.

**`sides: "client"` — inverted, not merely incomplete.** 31 of 57 delivery
sites are Rust, the 31 are the ones that cannot be fixed, and the leaf's largest
structural gap (G3) is entirely server-side. This is the eighth recorded
contradiction of that value; per the doctrine's instruction to say *which* kind,
this one is **inverted** — a client-scoped brief would find 26 sites and miss the
54% of the condition that carries the whole finding. The node's own
`twoSided: true` contradicts its `sides` in the same object.

## 11. Cross-check against the neighbours' prescriptions

Measured at **site level, against the final pattern**, by applying all 184
published rules' regexes to this rule's 6 matched files and comparing offsets
(±120 bytes). **Site overlap: 0.** File overlap: `catalog-boundary-escape` 6
files / 17 matches (import lines), `unresolved-error-as-inline-copy` 2,
`raw-web-storage` 1, `unmanaged-tauri-subscription` 1 — none within 120 bytes of
any of the 18 sites.

- **[`swallowed-error-telemetry`](./swallowed-error-telemetry.md)** prescribes
  binding the error and reaching a named door. This path agrees and adds the
  case its rule cannot see: **D2's three failures are not `catch` bodies at
  all**, they are bare `return`s on a permission check. `bindingless-catch-on-io`
  anchors on a `CatchClause`; there is no clause here to anchor on. That is a
  recall gap in the neighbour's instrument, reported rather than merged — the
  same shape as the doctrine's *"no signature is short a parameter"* case.
- **[`translation-completeness`](./translation-completeness.md)** governs the
  `en.json` catalog and the `i18n-no-gaps` hook. **Following both paths is safe
  and the composition is where the value is**: that path guarantees every *key*
  is translated in 14 languages; this one finds 52 strings that never became
  keys. A repo can be at 0 missing translations and still ship 91% of its
  desktop notifications in English, which is exactly the state measured here.
- **[`structured-logging`](./structured-logging.md)** — the Rust door's failure
  path is `tracing::warn!("Failed to send OS notification: {}", e)`
  (`notifications.rs:1544`), a message-string form that path prescribes moving
  into fields. Note the interaction that path's own §6 records: on the `error!`
  path, structured fields land in `event.tags`/`event.contexts`, which the
  Sentry scrubber does not touch. A notification title can contain a persona
  name; if this line is ever promoted to `error!` **and** restructured, the
  title moves from a scrubbed field into two unscrubbed ones. Named here so the
  two prescriptions are not applied blindly together.
- **[`inline-busy-state`](./inline-busy-state.md)** / the toast paths
  (`discarded-toast-copy`, `raw-error-as-toast-message`) cover the in-app
  channel. The boundary this path draws: a **toast** is for a user who is
  looking; a **notification** is for a user who has left; the **Notification
  Center record** is for a user who comes back. §2 requires the third
  unconditionally and the second only when the first would be missed.

## 12. Corrections

### 12.1 — To the brief: the silent drop is real, but it is not in a `catch`

The brief predicted "silent drop is the common defect" and pointed at
`toastCatch`/`silentCatch` and the doctrine's *760 try/catch bodies reach no
error door*. Measured: the four `try` blocks around OS sends **all** reach
`silentCatch` with a tagged label — `notifyProcessComplete.ts:63`,
`notifyFleetAwaiting.ts:27`, `useContextScanBackground.ts:44`,
`usePipelineNotifications.ts:97,99`. That half of the brief is refuted; the
error doors are wired.

The drop is one layer up, in a shape no catch-body census reaches: **three bare
`return` statements on the permission checks** (`osNotification.ts:18,21,23`),
plus `if (permitted)` with no `else` at three more doors, plus a Rust command
that returns `()`. The defect is *control flow*, not exception handling — which
is why it survived a repo-wide sweep that was looking for empty `catch {}`.

### 12.2 — To the brief: the stale-locale hypothesis is right, and the mechanism is different

The brief predicted "a notification composed at schedule time and delivered later
can carry a string from the previous locale". Tested against the two scheduled
paths: `useHealthDigestScheduler.ts:100-116` composes **at fire time** from
`interpolate(notif.*)`, and `useAssignmentNotificationDispatcher.ts:44-52`
composes at event time from `t.pipeline.assignments.*`. Neither carries a stale
locale.

The staleness is real and it is in the **persisted in-app record**: up to 50
`title`/`message` strings frozen in `localStorage` at fire time
(`notificationCenterStore.ts:56-75,154-155`), rendered beside a *label* that
`NotificationCenter.tsx:79` re-resolves live. **The primitive is half-live** —
one line of a bell row updates on a language switch and the line under it does
not. Sharper than the hypothesis, and in the opposite component.

### 12.3 — To the brief: the fallback exists, and knowing *which door* is the whole answer

The brief asked whether there is "a fallback to an in-app toast when the OS
refuses". There is, at 3 doors of 6 (D9), and at the best of them it is not a
fallback at all — `notifyProcessComplete` writes the record **outside** the
`try` rather than in a `catch`, so it fires whether the OS succeeded, failed,
was denied, or was never asked. That is a strictly better design than a
fallback (it needs no failure signal, which matters because G2 says there is
none), and it is the clause §2 promotes to doctrine.

### 12.4 — To this composer's own measurement: a vocabulary classifier false-positived exactly as the doctrine predicts

A first pass classified each delivery site as `i18n` / `HARDCODED` / `indirect`
by regexing a 7-line window for `t.`/`s.`/`tx(`. It reported
`useLabEvents.ts:33` as **i18n**; the file is
`sendAppNotification(\`Lab ${label} Failed\`, …)` and the match came from
`useAgentStore((s) => s.setLabProgress)` four lines below. One line above, `:31`,
was correctly flagged as hardcoded — so the classifier split a byte-identical
pair. Every one of the 26 sites was then opened by hand and the published counts
are the hand verdicts. This is the doctrine's *"a vocabulary-based signal's
precision is bounded by its author's word list"*, reproduced by a composer that
had just read the warning.

### 12.5 — To the spine

`convergence: mixed` **fails** (§10): a five-way zero is a silence, not a
mixture, and the label's direction is backwards — Personas is the only repo with
the situation. Fourteenth tested convergence label; thirteenth failure.

`sides: "client"` **fails, inverted** (§10). 31 of 57 delivery sites and the
entire structural gap are Rust. Eighth contradiction of that value.

`twoSided: true` **holds**, and it holds for the reason the contract requires
both halves to be written: the frontend half is fixable with a type change
(§4), the backend half is not fixable at all until Rust learns a locale (G3),
and the contract between them — `send_app_notification` returning `()` — is
itself a third finding (G2) that neither half owns.

### 12.6 — Not applied

Everything in §7 is a note. Deleting `requestNotificationPermission()` (D10) is
the only change this document would authorise under the campaign's rules
(a zero-consumer export whose signature is the defect) and it is held anyway
because five composers share this checkout and it sits in a file with six live
call sites. Widening `send_app_notification` to `Result` (G2), making `t`
required (D4), and replacing the harness gate (D6) all change behaviour or a
public signature. Written to
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) as item
**83**.
