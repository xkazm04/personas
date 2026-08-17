# Golden path — the first-use consent gate

> Situation node: `client-runtime/flows-and-onboarding/first-use-consent-gate` · [situation spine](../situation-spine.md)
> recurrence **11** · risk **HIGH** · sides **client** · convergence **converged (label REFUTED — see §12.1)**
> dimensions: **ui · security · function**
> Composed 2026-08-16 against `master` @ `e3c5e0d7f`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` files under `src/` (the census walk), plus `settings_keys.rs`
> (1,569 lines) and the onboarding/tour/analytics Rust and TS surfaces. Read in full:
> `shared/components/overlays/FirstUseConsentModal.tsx`, `lib/telemetryPreference.ts`,
> `lib/analytics/activation.ts`, `lib/analytics/sink.ts`, `lib/appearanceMirror.ts`,
> `stores/slices/system/tourSlice.ts` (persistence half), `stores/slices/system/onboardingSlice.ts`,
> `stores/systemStore.ts` (persist config), `hooks/sidebar/useWhatsNewIndicator.ts`,
> `settings/sub_admin/components/AdminSettings.tsx`,
> `settings/sub_account/components/AccountSettings.tsx`, `main.tsx`, `App.tsx`,
> `onboarding/components/useOnboardingState.ts`.
>
> **Measured by executing, not by reading.**
> 1. **The consent state machine was replayed**, transliterated line-for-line from
>    `telemetryPreference.ts:14-27`, `FirstUseConsentModal.tsx:31-58,141-151`, `App.tsx:174-178` and
>    `main.tsx:304`, across 8 profile scenarios × 3 storage modes. The two results in §0 are outputs
>    of that replay, not readings of the code.
> 2. **Read-only copies of both live SQLite databases** (`fucg-personas.db` 347 MB / 244 tables,
>    `fucg-personas_data.db` 17.5 MB / 71 tables, copied 2026-08-16 21:06 with their `-wal`/`-shm`,
>    opened `readOnly: true`; the live files were never opened for write) queried for every durable
>    one-time answer: **32 `app_settings`** rows, **15 `settings_audit_log`**, **0
>    `desktop_connector_approvals`**, **0 `companion_tours` in *both* databases**, **0 `trusted_peers`**.
> 3. **A read-only copy of the WebView2 `Local Storage` LevelDB** was scanned for the consent keys,
>    and the **live** profile was read through the test-automation harness on :17320 (`/eval` writing
>    to an off-screen DOM node, `/query` reading it back, node removed afterwards — verified gone).
>    **Nothing was answered, reset, or written in the running app; no consent row and no consent key
>    was modified.** No secret value appears below.
> 4. The §9 rule was built, counted twice by independent implementations, hand-verified 19/19,
>    positive-controlled, fault-injected **six** ways (all six fire), validated in a **private scratch
>    registry with a filename unique to this composer**, then re-extracted from this finished document
>    and re-run: identical. **The full registry was NOT run**, per the doctrine. `cargo` was not run.
>
> ### Sibling boundaries, settled in prose
>
> [**informed-consent-gate**](./informed-consent-gate.md) owns *what a human is told before they
> authorise one action*. This path owns *the question you are only ever allowed to ask once* — where
> its answer lives, what "absent" means, what happens on the second launch and on the upgrade, and
> whether the answer can be changed. A dialog that discloses its blast radius perfectly and then
> stores the answer where a profile clear erases it is 100% compliant with that path and 0% with this
> one.
>
> [**client-state-persistence**](./client-state-persistence.md) owns *which substrate a durable value
> belongs in*, and this path is a consumer of its rule, not a competitor — see §6's composition note,
> where following that path literally would break the consent gate and the correct reading is its
> **mirror** pattern.
> [**app-settings-store**](./app-settings-store.md) owns the backend key registry — including the
> `<KEY>_DEFAULT` convention this leaf must deliberately violate (§8.2).
> [**first-run-onboarding**](../situation-spine.md) (unwritten) owns the *sequence* that lands a new
> user on a working state; this path owns only the latch that says the sequence is over.
> [**tier-and-capability-gating**](./tier-and-capability-gating.md) owns "may this build do X"; this
> path owns "did this human agree to X, once, at the start".
>
> The **Deviations** section is a fix backlog. **No behaviour was changed by this composition.**

---

## 0. The headline: the gate records an answer the user did not give — and it has shipped twice

**`FirstUseConsentModal` re-opens on a consent-version bump, re-asks the telemetry question with the
checkbox hardcoded ON, never reads the answer already on disk, and writes whatever the checkbox says
when the user presses the only button there is.** A user who opted *out* of telemetry and then
upgrades has their refusal overwritten with an acceptance, by an interaction in which telemetry was
never mentioned to them.

```ts
// src/features/shared/components/overlays/FirstUseConsentModal.tsx:141-151
const [acknowledged, setAcknowledged]       = useState(false);
const [telemetryChecked, setTelemetryChecked] = useState(true);   // :142  <- never reads isTelemetryEnabled()
const handleAccept = useCallback(() => {
  persistConsent();                       // :148  localStorage[CONSENT_KEY] = CONSENT_VERSION
  setTelemetryEnabled(telemetryChecked);  // :149  unconditional write of a value the user never set
  onAccept();
}, [onAccept, telemetryChecked]);
```

Replayed, not read (`fucg-replay.mjs`, transliterated from the five files named in the header):

| launch scenario | Sentry init at boot | modal | version bump | telemetry box | **telemetry after Accept** |
|---|---|---|---|---|---|
| fresh profile, box left checked | **YES** | shown | – | ON | ENABLED |
| fresh profile, user unchecks | **YES** | shown | – | ON | disabled |
| **upgrade v2→v3, user had opted OUT** | no | shown | **YES** | **ON** | **ENABLED** |
| upgrade v2→v3, opted out, unchecks again | no | shown | YES | ON | disabled |
| settled v3, opted out, next launch | no | – | – | – | disabled |
| **storage write throws, user unchecks** | YES | shown | – | ON | **ENABLED** |

```
stored before : {"__personas_user_consent_accepted":"2","__personas_telemetry_enabled":"false"}
stored after  : {"__personas_user_consent_accepted":"3","__personas_telemetry_enabled":"true"}
```

**This is not hypothetical. The version has been bumped twice in shipped history:**

| commit | date | `CONSENT_VERSION` | commit subject |
|---|---|---|---|
| `d0c744db0` | 2026-03-10 | `'1'` | Persona matrix |
| `00ce77463` | 2026-04-04 | `'2'` | Dev tools completion |
| `686b2a9a7` | 2026-04-17 | `'3'` | **consent: fix wrong GitHub source link** and bump CONSENT_VERSION to 3 |

The second bump was to correct a hyperlink. **A cosmetic copy fix re-opened the consent gate and, for
every user who had refused telemetry, silently re-granted it.** The mechanism is one line
(`:142`) plus one line (`:149`), and no reviewer could have seen it, because each line is correct in
isolation: a fresh install *should* default the box to on-if-that-is-the-product-decision, and an
accept handler *should* persist what the box says. The defect only exists in the state where the
question is being asked for the *second* time — which is the state a version literal is there to
create.

> The last row of the table is the same defect from the other side. On a profile where
> `localStorage.setItem` throws — Safari private mode, a locked-down Windows profile,
> `NS_ERROR_FILE_CORRUPTED`, quota exhausted — the user unchecks the box, presses Accept, and
> `isTelemetryEnabled()` returns **`true`** on the very next read, because `telemetryPreference.ts:17`
> answers `true` from its own `catch`. The refusal evaporates between the click and the next
> statement. The same profile also re-shows the modal on every launch forever
> (`hasUserConsented()` = `false`), so the user re-refuses, and re-fails, indefinitely, with no
> message. The app already knows how to detect this exact condition — `tourSlice.ts:1084-1141` probes
> storage with a round-trip and raises a toast — and the consent gate does not use it.

### The second headline: the answer is enforced at one line, and 19 modules route around it

`isTelemetryEnabled()` is called at **two** sites in 4,829 files: `main.tsx:304` (the boot gate) and
`AccountSettings.tsx:28` (rendering the toggle's current position). That is the entire enforcement
surface of the app's only privacy consent.

| | count |
|---|---|
| modules under `src/` importing `@sentry/*` directly | **21** |
| …that actually emit (`captureException` / `captureMessage` / `addBreadcrumb` / `metrics.count` / `setTag` / `withScope`) | **21 of 21** |
| …that consult `isTelemetryEnabled()` | **1** (`main.tsx`) |
| `Sentry.init(` call sites in `src/` | **1** (`lib/sentry.ts:200`) |
| `Sentry.close(` / client teardown call sites | **0** |
| production call sites of `applyTelemetrySink` | **1** (`AccountSettings.tsx:52`) |
| default value of the analytics sink at module scope | **`sentrySink`** (`analytics/sink.ts:93`) |

The 20 non-`main.tsx` emitters are safe today for exactly one reason: `Sentry.init` never ran. Two of
them say so in a comment — `errorRegistry.ts:695` *"Safe to call before Sentry.init (no-op)"*,
`useTranslatedError.ts:43` *"safe before Sentry.init (no-op) and after (recorded on the active
scope)"*. **The consent answer is enforced by an initialisation that did not happen, not by a check.**
That distinction is invisible while the answer is "yes", and it has one live consequence: **turning
telemetry off mid-session in Settings tears down nothing.** `handleTelemetryToggle`
(`AccountSettings.tsx:47-55`) writes the key and swaps the analytics sink; there is no `Sentry.close`
anywhere in the tree, so all 21 modules keep reporting until the app is restarted. The code documents
the *inbound* half of this (`sink.ts:104-113`) and is silent on the outbound half.

### The third headline: five one-time gates, four substrates, three versioning strategies, one probe

Measured against the live profile through the harness (origin `http://localhost:1420`, **80**
localStorage keys) and against read-only copies of both databases:

| the one-time question | where the answer lives | absent means | versioned? | probe? | re-openable? | live value |
|---|---|---|---|---|---|---|
| "do you accept the disclosures?" | `localStorage['__personas_user_consent_accepted']` | not yet asked ✔ | **yes** — value *is* the version (`'3'`) | no | Admin tab (a **testing** surface) | `"3"` |
| "may we collect telemetry?" | `localStorage['__personas_telemetry_enabled']` | **yes, collect** ✘ | no | no | Settings → Account ✔ | `"true"` |
| "is first-run onboarding done?" | **two** places: `localStorage['onboarding-state-v1']` *and* `persona-ui-system.state.onboardingCompleted` | not done ✔ | key-name only / none | no | `reopenOnboarding()` ✔ | **`onboarding-state-v1` does not exist**; `onboardingCompleted: false` |
| "have you taken the tour?" | `localStorage['guided-tour-state']` + `persona-ui-system.state.tourCompleted`/`tourDismissed` | not taken ✔ | **`version: 4` in payload, discard on mismatch** | **yes** | Admin tab | tour v4; `getting-started` dismissed at step 2; `tourDismissed: true` |
| "have you finished the starter quest?" | `app_settings['onboarding_quest_state']` (DB) | – | doc has no version | n/a | none | 5/5 milestones, **`completedAt: null`**, last written **2026-05-07**, **0 consumers in `src/` or `src-tauri/src/`** — only declared at `settings_keys.rs:227` |
| "may this desktop app have these capabilities?" | `desktop_connector_approvals` (DB) | not granted ✔ | no | n/a | **no UI** (see [informed-consent-gate §7.F](./informed-consent-gate.md)) | **0 rows** |
| "may the companion act unattended?" | `app_settings['companion_autonomous_mode']` | off ✔ | no | n/a | the infinity toggle ✔ | `true` |

Three facts fall out of that table and none of them is visible from any single file:

1. **`onboarding-state-v1` has never been written on this install.** Its own comment
   (`onboardingSlice.ts:100-107`) says it exists so that *"a completed user can be re-prompted"* is
   impossible — but the same fact is also persisted by `systemStore`'s `partialize`
   (`systemStore.ts:83-85`), which rehydrates **after** the slice initialiser reads the standalone
   key. **Two writers, one fact, and the one that wins is not the one with the docstring.**
2. **`persona-ui-system` carries `version: 0`** — read live off the profile; zustand's value when no
   `version` is configured. It stores five one-time answers (`onboardingCompleted`, `tourCompleted`,
   `tourDismissed`, `setupCompleted`, `whatsNewSeenVersion`) with no migration hook. Of the **8**
   `persist()` configs in the tree, **1** declares a `version` — and one of the 8 is a JSDoc example
   (`dedupedStorage.ts:45`), a false positive **both** of my independent counters produced, in the
   same direction.
3. **The substrate is per-WebView-origin.** The LevelDB copy holds consent keys under **three**
   distinct origins — `http://tauri.localhost`, `http://localhost:1420`, `http://localhost:1430`.
   A production build, a dev build and a dev build on a different port each hold an independent copy
   of the answer. "Remembered forever" means "remembered for this origin".

And one thing the app gets right that nothing else in the sweep does: `useWhatsNewIndicator.ts:56-59`
writes a **silent baseline** on first launch precisely so that *never asked* and *acknowledged* stay
distinguishable — `if (appVersion && seenVersion === null) markWhatsNewSeen(appVersion)`, with the
reasoning at `:16-21`. That is the tri-state discipline the telemetry key does not have, implemented
242 lines away from the consent key in the same repo.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and the definition of the situation.** *A one-time question has three answers, not
> two: **not yet asked**, **yes**, and **no**.* The moment you store it as a boolean you have deleted
> the first one, and every later behaviour — whether to show the gate, what the feature does before
> the gate is answered, what a cleared profile means — has to guess it back. Store a value whose
> absence is unambiguous, and make absence mean *ask*, never *proceed*.
>
> **P2 — physics, and the clause this leaf exists for.** *When you re-open a one-time gate, read the
> previous answers first and pre-fill from them.* Re-opening is not a first run; the user has already
> spoken. A re-ask that initialises its controls from constants does not collect a new answer, it
> **overwrites the old one with a default**, and the user experiences that as a single click on a
> button labelled "Accept". The tell is a version literal in the gate plus a hardcoded initialiser in
> its controls, in the same file.
>
> **P3 — physics.** *A gate whose answer is stored in a substrate that can silently fail is not a
> gate.* Probe the substrate with a real write-read-delete round trip before you rely on it, decide
> what the app does when it is unavailable, and tell the user. Write-and-hope with a swallowed catch
> produces the worst outcome available: a refusal that does not take effect and a question that is
> asked forever, both silent.
>
> **P4 — physics, and the asymmetry that does the damage.** *Every read of a stored consent must fail
> **closed**, including the `catch`.* The error path is written by whoever was thinking about errors,
> not about consent, and it defaults to whatever keeps the feature working. That default is the
> permissive one roughly every time, so the exact conditions under which storage breaks are the
> conditions under which the user's refusal is discarded.
>
> **P5 — physics.** *Count the call sites of the function that reads the answer.* A one-time consent
> is worth exactly the number of places that consult it. If the answer is enforced by *not
> initialising something*, then every module that touches that something is governed by an accident
> of module-load order, and the accident reverses the first time someone withdraws consent
> mid-session — because un-initialising is a step nobody wrote.
>
> **P6 — physics.** *One fact, one home.* Two stores that both remember "the user finished
> onboarding" do not agree; they race, and the winner is decided by hydration order, which is not
> written down anywhere. Pick the authority explicitly and let the other be a cache that is *derived*,
> never a second source.
>
> **P7 — ergonomics.** *A gate with one button is an acknowledgement; do not call it consent.* If
> there is no decline branch, the honest words are "I understand", not "I agree", and the thing you
> obtained is a receipt, not a permission. If a genuine refusal is impossible (the app cannot run
> without it), say what the user's actual remedy is — quit, or a reduced mode — and offer it.
>
> **P8 — ergonomics, and the one that makes withdrawal real.** *Granting and reviewing are two
> features, and the review surface must be for users, not for the team that built it.* A reset button
> on a page called "development tools and testing utilities" is a test fixture. The user-facing form
> is a page that lists what was agreed, when, and under which version, with a control per item.
>
> **P9 — function.** *Version the document, never the key, and state the migration.* A version bump
> is a controlled re-ask; decide in advance which stored answers survive it and which are genuinely
> invalidated, and write that down beside the literal. A bump with no migration policy re-asks
> everything, which is the same as remembering nothing.
>
> **P10 — security.** *The answer must be readable at the moment the gated behaviour starts.* If the
> behaviour is decided at process start and the answer lives behind an async read, the answer arrives
> too late and the behaviour has already happened. That constraint dictates the substrate, and it is
> the one place where the fast, fragile, synchronous store is the right choice — as the *render*
> authority, mirrored to a durable one, not as the only copy.
>
> **Scale condition.** P1, P4 and P7 are correctness on the first dialog. P3 arrives with the first
> support ticket from a managed device. P2 and P9 arrive the first time you change the disclosure —
> which for most products is month three, and is when the damage is done invisibly. P5 and P6 arrive
> when the second developer adds a second emitter and a second store. P8 arrives with the first
> regulator, the first enterprise buyer, or the first user who changes their mind.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud` (TS
orchestrator/worker + Python facade), `vibeman` (Next.js + Tauri), `ascent` (Next.js). All five
reachable and swept for both the *mechanism* (localStorage / cookie / zustand-persist / `version:` +
`migrate:` / SQL `DEFAULT` + backfill / audit-actor columns / SDK init sites / SDK deps in
`package.json`) and the *name* (consent / cookie / terms / GDPR / opt-in / first-run / telemetry) —
the two blind spots that have inverted previous sweeps.

- **The spine's `converged` label fails on the first clause. A *blocking* one-time acceptance exists
  in 0 of 5 siblings.** The only consent gate in the set is `personas-web`'s `CookieConsent`
  (`src/components/CookieConsent.tsx:51`, mounted at `app/layout.tsx:130`) and it is a **dismissible
  bottom banner** with no overlay and no focus trap. `brainiac` declines to have one **by argued
  decision** (`console/app/privacy/page.tsx:131-132` — *"no consent banner is required and none is
  shown"*, coupled to `console/src/analytics/config.ts:11-13` warning that swapping the analytics
  tool invalidates the position). `personas-cloud` is headless. `vibeman`'s and `ascent`'s onboarding
  are non-blocking progress surfaces. Personas' `onClose={noop}` blocking modal is **unique in the
  set**, and this document's entire subject therefore has one implementation, not six.
- **P2 has NO external warrant and must be reported as silence — because no sibling can re-open a
  gate at all.** A `CONSENT_VERSION`-style literal is **0 of 5**. The nearest miss is instructive:
  `personas-web` has `POLICY_META.privacy.latestUpdateIso` (`src/data/policy-changelog.ts:11`)
  compared against a stored date, and it drives **only a `<details>` badge**
  (`PolicyChangelog.tsx:15`) — it never re-opens the banner. And where that repo *does* re-open
  (`reopenCookieConsent`, `CookieConsent.tsx:18-23`) it **deletes the stored answer first**, so
  pre-filling is structurally impossible and the question does not arise. **P2 is this repo's own
  invention, earned from its own defect, and externally untested.** An adopting repo should treat it
  as strongly-reasoned rather than as established practice.
- **P4 is physics — 2 of 2 repos that read a consent key fabricate an answer in the `catch`, in
  opposite directions of the same mistake.** `personas-web/src/components/CookieConsent.tsx:35-41`:
  `function readConsent() { try { return localStorage.getItem(KEY); } catch { return "essential"; } }`
  — unreadable storage **invents a consent decision that was never made**. Personas'
  `telemetryPreference.ts:17` returns `true` from the same position. Neither repo's catch was written
  by someone thinking about consent, and both chose the branch that keeps the product working.
- **P1 is convergent as a failure, and the sibling shows the same collapse one layer down.**
  `personas-web` genuinely has three states at the banner (`null` / `"essential"` / `"all"`) and
  collapses them to a boolean at every downstream consumer — `analytics.ts:13`
  (`getItem(KEY) === "all"`, the one correct restrictive read in the whole sweep) and
  `policy-changelog.ts:64-65` (`if (lastSeen === null) return false;`, commented *"treat as a first
  visit; don't surprise the user"* — i.e. absence is deliberately made indistinguishable from
  "nothing new"). **Nobody keeps the tri-state past the first function boundary.**
- **P3 is physics as a failure — 0 of 5 probe their storage, 5 of 5 write and hope.** `personas-web`
  carries **8 swallowed catches** around its one-time keys alone (`CookieConsent.tsx:21,38,47`;
  `policy-changelog.ts:49,58`; `TourLauncher.tsx:68,84,96`), none surfaced to the user.
  **Personas' `tourSlice.probeTourStorage` (`tourSlice.ts:1084-1141`) is ahead of all five
  siblings** — a real round-trip, a Sentry breadcrumb, a one-time toast, and a documented degrade to
  in-memory. Reported as a lead, not as doctrine: one repo doing something is an existence proof, not
  physics.
- **P5 is physics — 2 of 2 repos with a client SDK initialise it at module scope, before consent, and
  0 of 5 de-initialise on withdrawal.** `personas-web/sentry.client.config.ts:3` →
  `src/lib/sentry.ts:18` calls `Sentry.init` unconditionally (DSN-gated only), exactly as
  `main.tsx:304` does here; only the bespoke metrics helper is consent-gated (`analytics.ts:29`).
  Withdrawal in that repo removes the key and the Sentry client **keeps capturing until reload** —
  the same hole measured here. This confirms and extends
  [informed-consent-gate](./informed-consent-gate.md)'s C4 result with the withdrawal half.
- **P6 has one external warrant and it is a warning, not a model.** `vibeman` demonstrably *knows*
  the versioned-persist pattern — `cliSessionStore.ts:418` (`version: 9` plus a `migrate:` at `:426`)
  — and applies it to CLI sessions while `userConfigStore.ts:41` carries `version: 1` with no
  `migrate`, and consent gets neither. The knowledge exists in the repo and does not reach the
  durable-answer surface. Same shape as `persona-ui-system` at `version: 0` here.
- **P7 is unmeasurable elsewhere — 0 of 5 siblings have a blocking gate to put a second button on.**
  Personas' single-button, `onClose={noop}` modal is the only instance of the situation, so the
  "acknowledgement vs consent" clause is reasoned from first principles and from the copy, not from
  convergence. Treat as a house judgement.
- **P8: revocation exists in exactly one sibling and it is better than this repo's.**
  `personas-web`'s `CookieSettingsButton.tsx:15` → `reopenCookieConsent`, rendered from the public
  cookie policy page (`app/legal/policies/CookiePolicy.tsx:95`), with cross-tab synchronisation via
  `storage` + a custom `cookie-consent:reopen` event (`CookieConsent.tsx:60-73`). It is a **user**
  surface on a **legal** page. Personas' equivalent is a button on a tab whose own subtitle is
  *"Development tools and testing utilities"* and whose hint is *"Reset the first-use consent modal
  to test onboarding"* (`en.json` → `settings.admin`).
- **P9 has no external warrant at all — 0 of 5, because 0 of 5 version a consent answer.** Silence.
- **The highest-value clause, and it is convergent: a one-time answer recorded without the user
  answering exists in 3 of the 5 reachable repos including this one, with `personas-web` at 4
  distinct instances.** Its sharpest are `LegalContent.tsx:70` — merely *landing* on `/legal` calls
  `writeLastSeen(initial, todayIso())`, permanently marking the policy as read (also at `:80` on
  hashchange and `:95` on a tab click) — and `TourLauncher.tsx:79-82`, where a `?tour=1` URL
  parameter writes the one-time seen-flag **before any interaction**. `brainiac` back-fills
  attribution nobody signed (`migrations/0030_library_proposals.sql:10,17`:
  `ADD COLUMN origin text NOT NULL DEFAULT 'human'` followed by
  `UPDATE standards SET origin='sweep' WHERE NOT EXISTS(…)`). **The class is physics; §0's version-bump
  variant is this repo's own contribution to it.**

**Silence, reported as silence.** **Consent stored anywhere but one browser's localStorage: 0 of 5.**
No sibling puts a consent answer in a database, a cookie readable by the server, or a user profile —
100% of consent state in the entire sweep is per-profile browser storage, exactly the substrate
[client-state-persistence](./client-state-persistence.md) says has already cost this repo three
data-loss incidents. **A consent ledger recording an actor: 0 of 5.** The closest is `brainiac`'s
`provenance(actor_kind text -- human | agent | pipeline)` (`migrations/0001_init.sql:52-61`) and
`ascent`'s hash-chained `AuditEvent` with `actorId` (`src/lib/db/audit-integrity.ts:24,51`) — both
correct shapes, **neither applied to consent in any repo.**

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "show this once and then never again" / "don't show this again"
- "first-run consent" / "terms acceptance" / "telemetry opt-in" / "cookie banner"
- "we need to re-ask everyone because the disclosure changed"
- "just store a flag in localStorage so we know they've seen it"
- "enable this feature? ask them the first time they open it"
- "mark onboarding as complete" / "mark the tour as dismissed"
- **The "about to write X" test:** you are about to type
  `localStorage.setItem('…_seen', 'true')`, `getItem(K) !== 'false'`, `useState(true)` for a checkbox
  whose value gets persisted, `const X_VERSION = '2'` above a gate, `hasSeenX: boolean` in a store's
  `partialize`, a `dismissed BOOLEAN DEFAULT 0` column with no `dismissed_at` beside it, or an
  `if (!flag) return <Gate/>` where `flag` came from a store that hydrates asynchronously.

You are **not** in this situation when the question is asked *every* time (that is
[informed-consent-gate](./informed-consent-gate.md)), when it is per-surface view state such as a
collapsed panel or a sort order (that is view-state persistence), when the "one time" is per-session
rather than per-install (that is component state and should stay component state), or when the
decision is the build's rather than the user's ([tier-and-capability-gating](./tier-and-capability-gating.md)).
**The discriminator is that the answer outlives the process and changes what the app does before the
user can be asked again.**

---

## 2. The one way

**Store a value whose *absence* means "not yet asked", never a boolean; pre-fill every control from
the stored answer before you re-show the gate; and probe the substrate before you trust it.**
Concretely: give the key a value that *is* the disclosure version (`CONSENT_KEY = CONSENT_VERSION`,
`FirstUseConsentModal.tsx:56`) and expose **two** readers — `hasUserConsented()` for "is the current
version accepted" and `storedConsentVersion()` for "have we ever asked" (`:31-46`); `App.tsx:174-178`
uses both together and that pairing is the single best thing in this leaf. Every dependent
preference the gate collects must be initialised from its own stored value —
`useState(isTelemetryEnabled)` the way `AccountSettings.tsx:28` already does it — **never from a
literal**, because the second time the gate opens the literal is an answer you are inventing. Read
storage through a probe that does a real `setItem`/`getItem`/`removeItem` round trip, caches the
verdict, degrades to in-memory and tells the user once: copy `tourSlice.ts:1084-1141` verbatim; do
not write a 33rd private `try { … } catch { silentCatch }` around a consent write. Make every read
fail **closed** — `getItem(K) === 'accepted'`, never `!== 'refused'` — including the `catch`, which
must return the restrictive value even though the surrounding feature will then not work; that is the
point. Put the durable copy in `app_settings` through
[`client-state-persistence`](./client-state-persistence.md)'s **mirror** pattern, not its
backend-authority pattern, because the decision is made at module scope before any IPC can resolve
(§6); `main.tsx:36` already captures exactly the signal this needs — *"whether
`localStorage['persona-theme']` existed at boot, captured BEFORE the store can write it"* — and
`bootstrapAppearanceMirror(hadLocalAppearance)` (`appearanceMirror.ts:193-215`) already spends it to
tell a fresh/cleared profile from a returning one. **Version the document, not the key**, and when
you bump the version write down beside the literal which stored answers survive the bump. Enforce the
answer at **one function that everything calls**, not by declining to initialise a global — a
withdrawal must have somewhere to take effect, and `Sentry.close` is the step nobody writes. Give the
gate a **decline** or stop calling it consent; and put the review surface where a user will find it
(Settings, beside the thing it governs), not on the Admin tab whose subtitle is *"Development tools
and testing utilities"*.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src/features/shared/components/overlays/FirstUseConsentModal.tsx:31-58`** — `hasUserConsented` / `storedConsentVersion` / `resetUserConsent` / `CONSENT_KEY` | **The tri-state reader pair, and the reference for P1.** `hasUserConsented()` is `stored === CONSENT_VERSION` — fails closed, and its `catch` returns `false`. `storedConsentVersion()` returns the raw value or `null`, so *never asked* is a distinct, testable fact. `App.tsx:175-178` composes the two into `isVersionBump`. Copy this pair for any one-time answer. Its defects are §7.A and §7.B. |
| **`src/stores/slices/system/tourSlice.ts:1084-1141`** — `probeTourStorage` | **The only storage probe in this repo or any of the five siblings.** A real `setItem`/`getItem`/`removeItem` round trip cached on `globalThis`, a Sentry breadcrumb on both outcomes, `captureMessage` on failure, **one** toast per session, and a documented degrade of `persistState()` to a no-op so the feature still works in memory. The docstring names the real-world triggers (Safari private mode, storage-full, `NS_ERROR_FILE_CORRUPTED` on locked-down corporate Windows profiles). **Lift this into a shared helper — §8.1.** |
| **`src/stores/slices/system/tourSlice.ts:1143-1213`** — `PersistedTourState` / `loadPersistedState` / `persistState` | **The versioned-document pattern for a one-time answer.** `TOUR_STATE_VERSION = 4` lives *inside* the payload while the key stays `guided-tour-state`; a lower version is `removeItem`'d and treated as absent (`:1163-1166`); a parse failure is distinguished from unavailability in a comment (`:1168-1179`) and deliberately does **not** toast, because the user is not stuck. A mid-session write failure flips the cached verdict so writes stop retrying (`:1194`). |
| **`src/lib/appearanceMirror.ts:193-215`** — `bootstrapAppearanceMirror(hadLocalAppearance)` | **The fresh-profile-vs-returning-user discriminator, already built and tested.** Takes a boolean captured at `main.tsx:36` *before any store can write*, and branches: no local value → hydrate from the backend row; local value but no backend row → one-time migration push; neither → genuine first run. This is the durable half the consent gate is missing, in the mirror shape P10 requires. `coerceAppearancePrefs` (`:92`) treats the backend blob as untrusted per-field. |
| **`src/hooks/sidebar/useWhatsNewIndicator.ts:56-59`** | **The silent-baseline pattern.** `if (appVersion && seenVersion === null) markWhatsNewSeen(appVersion)` — on a fresh install, record the current version and show nothing, so a *future* change is what fires. The docstring at `:16-21` states the invariant. The honest way to collapse a tri-state to a boolean: write the third state down rather than inferring it. |
| **`src/lib/telemetryPreference.ts:23-27`** — `setTelemetryEnabled` | The writer. Symmetric (`"true"`/`"false"`), so a *written* refusal is distinguishable from an absent key — the reader is what throws that away (§7.A). |
| **`src/features/settings/sub_account/components/AccountSettings.tsx:28,47-55`** | **The correct control initialiser**, `useState(isTelemetryEnabled)`, and the correct change handler shape: persist, apply the live effect, update local state, flag that a restart note is needed. This is exactly the initialiser the consent modal does not use. |
| **`src/features/settings/shared/useConfirmClick.ts`** | The arm/commit affordance the consent-reset button uses (`AdminSettings.tsx:16-21`) — first click arms, 3 s auto-revert, timer ref-tracked and cleared on unmount. Correct for a destructive one-time-state reset. |
| **`src-tauri/db/src/settings_keys.rs`** | The durable registry a mirrored consent answer must be declared in — `ALLOWED_KEYS` + a `<KEY>_DEFAULT` + a `validate_value` arm. A key not registered is **rejected by `repos::core::settings::set`**. Note §8.2: for a consent key the `_DEFAULT` must be a sentinel, not a value. |
| **`settings_audit_log`** (`personas.db`) | **A consent ledger already exists, and one consent surface is already in it.** `(category, setting_key, action, before_value, after_value, actor, created_at)`. `companion_autonomous_mode` — the standing-consent switch — has **2** rows: `true→false` 2026-07-26, `false→true` 2026-08-05. This is the table the first-run and telemetry answers should be writing to. |

**Do not exist — this path names them:**

- **Any shared storage-availability probe.** `probeTourStorage` is one feature's private function;
  the consent gate, the onboarding latch and 30-odd other one-time writers each have their own bare
  `try`/`catch`.
- **Any user-facing surface listing what has been agreed to.** The only reader of `CONSENT_KEY`
  outside the modal is the Admin tab, whose own subtitle is *"Development tools and testing
  utilities"*.
- **Any durable copy of the first-run or telemetry answer.** `app_settings` holds **32** rows and
  **zero** consent keys; both answers exist only in one WebView origin's localStorage.
- **Any migration policy for a consent-version bump.** `CONSENT_VERSION` has moved twice and no
  commit records which stored answers were meant to survive.
- **Any teardown for the telemetry SDK.** `Sentry.close` appears **0** times in 4,829 files.

---

## 4. Steps

1. **Write down the three states before you write the gate**: what does *absent* mean, what does
   *yes* look like on disk, what does *no* look like on disk. If *absent* and *no* serialise the
   same, start over — you have a two-state store for a three-state fact.
2. **Choose the value so that absence is unambiguous.** The strongest form in this repo: the stored
   value *is* the disclosure version, so `null` = never asked, `'2'` = agreed to something older,
   `'3'` = current. A bare `'true'` cannot express the middle state and a version bump then has
   nothing to compare against.
3. **Expose two readers, not one** — `isAnswered()` and `storedAnswer()` — and make the caller
   compose them (`App.tsx:175-178`). One reader that returns a boolean forces every caller to guess.
4. **Probe the substrate at boot, once.** `setItem`/`getItem`/`removeItem` round trip, cached verdict,
   breadcrumb on both outcomes, one toast on failure, documented degrade. Copy
   `tourSlice.ts:1084-1141`. **Decide explicitly what the gate does when storage is unavailable** —
   asking forever with no effect is not a decision, it is the default.
5. **Make every read fail closed, `catch` included.** `=== 'granted'`, never `!== 'refused'`. Then
   write the test that asserts the `catch` branch returns the restrictive value; it is one line and it
   is the only thing standing between a locked-down profile and a silent opt-in.
6. **Initialise every control in the gate from its own stored value.** `useState(readStoredX)`, never
   `useState(true)`. This is the whole of P2 and it is one character of diff per control.
7. **Mirror the answer to the durable store** with the mirror pattern (localStorage = synchronous
   render authority, `app_settings` = the row that survives a profile clear), using the
   `hadLocalX`-captured-at-`main.tsx` signal to tell a cleared profile from a first run. Register the
   key in `settings_keys.rs` in the same change — and see §8.2 about `<KEY>_DEFAULT`.
8. **Version the document, not the key**, and write the migration policy as a comment beside the
   literal: which answers survive the bump and which are invalidated. If the answer is "all of them
   survive except the disclosure acceptance", say so, because that is not what the code will do by
   default.
9. **Ask the type question now, before §9** — see below. For this leaf the answer is a genuine yes and
   it is the reader's return type.
10. **Enforce the answer at one function everything calls**, and make withdrawal reach it. Count the
    modules that can produce the gated effect without passing through that function; if the count is
    not zero, the enforcement is an accident of initialisation order and it reverses on the first
    mid-session withdrawal.
11. **Ship the review surface with the gate** — in Settings, beside the feature, listing what was
    agreed and when, with a control per item. Not on an Admin tab. And write the grant *and* the
    withdrawal to the audit table that already exists.
12. **And then stop.** Which substrate a durable value belongs in is
    [client-state-persistence](./client-state-persistence.md); how the backend key is declared is
    [app-settings-store](./app-settings-store.md); what a per-action confirmation must disclose is
    [informed-consent-gate](./informed-consent-gate.md); the overlay mechanics are
    [modals](./modals.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, and unusually cleanly, because the defect is a *return type*, not a call site.**

The proposed edit is `src/lib/telemetryPreference.ts`:

```ts
// today — three states collapsed into two, and the collapse is invisible at every call site
export function isTelemetryEnabled(): boolean {
  try { return localStorage.getItem(TELEMETRY_KEY) !== "false"; } catch { return true; }
}

// proposed — the third state becomes spellable, and unhandled becomes a compile error
export type ConsentAnswer = 'granted' | 'refused' | 'never-asked' | 'unreadable';
export function telemetryConsent(): ConsentAnswer { … }        // no boolean escapes the module
export function mayCollectTelemetry(a = telemetryConsent()) {  // the ONLY boolean, one place
  return a === 'granted';                                       // never-asked and unreadable => false
}
```

Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** `ConsentAnswer` encodes *which* state, not
  *whether the caller handled it correctly*. A caller can still write
  `telemetryConsent() !== 'refused'` and reproduce today's bug. What it buys is that doing so is now a
  **written, greppable claim** rather than the invisible default of a `!==` against a string.
- **Q2 — requiredness ≠ closedness.** Both edits are needed and they are different. Making the return
  non-optional changes nothing (it already is); **closing the union is the entire win**, and it is the
  same shape as `timezone: Option<Tz>` in [scheduled-trigger-firing](./scheduled-trigger-firing.md).
- **Q3 — a type nobody constructs constrains nothing.** Construction sites are enumerable and tiny:
  **2** readers of `isTelemetryEnabled` (`main.tsx:304`, `AccountSettings.tsx:28`) and **1** writer
  (`setTelemetryEnabled`, 2 call sites). Small enough to land in one commit — and, exactly as
  Q3 warns, **too small to be the whole answer**, which is why §9 gates the *reach* of the answer
  rather than its shape.
- **Q4 — a type anyone can construct authenticates nothing.** `'granted'` is a string literal anyone
  can type. This raises the cost of an accidental opt-in; it does not forbid a deliberate one.
- **Q5 — withholding beats requiring, and it points at the better edit.** Do not export the boolean
  at all. Export `mayCollectTelemetry()` and keep `ConsentAnswer` module-private, so there is no
  unmetered entry point — the same three-door result
  [headless-model-call](./headless-model-call.md) measured (withhold → 8/8 correct; hand back → 2/2
  wrong). Applied here: **withhold the raw string** and the `!== 'false'` bug becomes unspellable
  outside the module that owns the key.
- **Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is *comparing the
  stored string yourself*. Withholding the answer entirely (making callers pass consent in) would
  just push `main.tsx` to read localStorage directly, which is where it started.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  Applies to §0's headline and is the honest limit: `useState(true)` at
  `FirstUseConsentModal.tsx:142` is type-correct under any signature. **No type reaches a component's
  own initial state.** The fix there is `useState(isTelemetryEnabled)` — a review-and-lint concern,
  not a type one, and it is the §9 residue.

**Where the type does not reach**, three places, all measured:

1. **Into a component's `useState` initialiser.** §0's defect. 1 site, and a closed union would not
   have caught it.
2. **Into module-load order.** The enforcement is *"`Sentry.init` was not called"*. No parameter,
   no return type and no lint rule reaches a decision made by an `if` at module scope in `main.tsx`
   whose consequence is the absence of a side effect — the doctrine's second "where types cannot
   reach" case (a value that never crosses a parameter), in its purest form.
3. **Into the WebView origin.** The same code, the same types, and three independent copies of the
   answer keyed by `location.origin`. Nothing in the type system knows which profile it is running in.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Re-opening a one-time gate whose controls initialise from literals** | §0. The re-ask overwrites the previous answers with defaults, and the user sees one button. `FirstUseConsentModal.tsx:142` + `:149`; two shipped bumps, the second for a hyperlink fix. |
| **`getItem(K) !== 'false'`** | Absence — which is *every fresh profile, every cleared profile, and every new WebView origin* — reads as consent. **2 sites** in 4,829 files (`telemetryPreference.ts:16`, `scanSweep.ts:22`) against **12** that use the fail-closed `=== 'literal'` form. The minority form is the one guarding the privacy decision. |
| **A `catch` that returns the permissive value** | `telemetryPreference.ts:17` returns `true`; `personas-web/CookieConsent.tsx:39` returns `"essential"`. The storage failure and the consent bypass are the same event, and neither is logged. |
| **Enforcing a consent by not initialising something** | There is then no place for withdrawal to act. **21** modules import `@sentry/*`; **0** `Sentry.close` call sites; a mid-session opt-out stops usage analytics (`applyTelemetrySink`) and nothing else. `sink.ts:104-113` documents the inbound half and is silent on the outbound half. |
| **A one-time gate with exactly one button** | `FirstUseConsentModal.tsx:326-338` — Accept, gated on `acknowledged`, with `onClose={noop}` (`:156`). There is no decline, so the checkbox obtains an acknowledgement and the copy calls it consent. |
| **Two stores remembering one fact** | `onboardingCompleted` lives in `onboarding-state-v1` (`onboardingSlice.ts:109`) *and* in `persona-ui-system` (`systemStore.ts:83`). The slice initialiser reads the first, zustand's rehydrate then overwrites from the second. **Live proof: `onboarding-state-v1` does not exist on this profile** while `persona-ui-system.onboardingCompleted` does. |
| **A persisted store of one-time answers with no `version`** | `persona-ui-system` is at **`version: 0`** (read live) and carries five one-time answers. Rename a flag and every one of them silently reads `undefined` → falsy → the gate re-opens or a completed latch resets. **1 of 8** persist configs declares a version. |
| **A consent answer that exists only in `localStorage`** | It is per-WebView-origin (**3** origins on this machine), invisible to the backend, and erased by a profile clear — the failure [client-state-persistence](./client-state-persistence.md) says has cost this repo three data-loss incidents. `app_settings`: **32** rows, **0** consent keys. |
| **Writing a one-time answer with a bare swallowed `try`** | `persistConsent` (`:54-58`) and `setTelemetryEnabled` (`:23-27`) both `catch { silentCatch(...) }`. On a storage-hostile profile the write fails, the user's refusal never lands, and the app reports success by returning normally. The repo's own probe (`tourSlice.ts:1084`) exists and is not used here. |
| **A reset button on a page labelled "testing utilities"** | `AdminSettings.tsx` is the only surface that reads `CONSENT_KEY` outside the modal; `settings.admin.consent_hint` reads *"Reset the first-use consent modal to test onboarding"*. A developer fixture is not a withdrawal mechanism. |
| **Resetting one half of a coupled pair** | `resetUserConsent()` (`:48-52`) removes `CONSENT_KEY` and leaves `TELEMETRY_KEY` untouched — so the reset path walks straight into §0's defect and flips a stored `false` to `true` on the next Accept. |
| **A stranded one-time answer** | `app_settings['onboarding_quest_state']` holds 5/5 milestones with `completedAt: null`, last written 2026-05-07, and has **0** readers or writers in `src/` or `src-tauri/src/` — only a constant at `settings_keys.rs:227`. Nobody can finish it and nobody can clear it. |
| **Hardcoded English inside the consent modal** | `:172-175` — *"We've updated our disclosures. Please review the changes before continuing."* is a string literal in a 14-locale app, on the **version-bump branch specifically**, i.e. the sentence that exists to explain why the user is being asked again is the one sentence not translated. Every other string in the file is `c.*`. |
| **A one-time latch in `useState`** | It forgets on unmount, so "once" means "once per mount". **5** sites: `GlyphCinemaLayout.tsx:53`, `GlyphDialogueCinemaLayout.tsx:66`, `ObservabilityDashboard.tsx:99`, `UnifiedBuildEntry.tsx:186`, `MastermindPage.tsx:188`. Small, and legitimate for two of them — listed so the next one is a decision rather than a habit. |

---

## 6. Evidence

### The one site to copy: `src/main.tsx:36` + `src/lib/appearanceMirror.ts:185-215`

```ts
// src/main.tsx:36 — captured at module scope, BEFORE any store can write it
const hadLocalAppearance = localStorage.getItem('persona-theme') != null;
```

```ts
// src/lib/appearanceMirror.ts:185-215
/** @param hadLocalAppearance whether `localStorage['persona-theme']` existed at
 *   boot (captured in main.tsx BEFORE the store can write it). When false, the
 *   webview profile is fresh/cleared → hydrate from the backend. When true →
 *   one-time migration push if the backend has no row yet. */
export async function bootstrapAppearanceMirror(hadLocalAppearance: boolean): Promise<void> {
  …
  const raw = await getAppSetting(APPEARANCE_PREFERENCES_KEY);
  if (!hadLocalAppearance) {
    if (raw) applyAppearancePrefs(coerceAppearancePrefs(JSON.parse(raw)));
    // No backend row either → first-ever run; the defaults already applied.
  } else if (!raw) {
    flushWriteThrough();   // existing local prefs, no mirror yet — one-time migration
  }
```

Four properties make it the reference, and none of them is about appearance:

1. **It captures the "was this profile fresh?" bit at the only moment it is still true** — before any
   store writes. That bit is the entire difference between *never asked* and *asked and forgotten*,
   and it is unrecoverable one tick later.
2. **It branches on all three states explicitly**, including the "neither" case, with a comment for
   each.
3. **It reads the durable copy asynchronously while the synchronous copy has already rendered** —
   which is precisely the P10 constraint the consent gate lives under, solved.
4. **It is unit-tested per branch** (`__tests__/appearanceMirror.test.ts:98,122`), including the
   fresh-profile arm.

The consent gate sits **268 lines below** the line that captures the same signal for the theme, in
the same file, and does not use it.

### The runner-up, and the only storage probe in six repositories

```ts
// src/stores/slices/system/tourSlice.ts:1092-1105
try {
  if (typeof localStorage === "undefined") { errorMessage = "localStorage is undefined (SSR/sandbox)"; }
  else {
    localStorage.setItem(TOUR_STORAGE_PROBE_KEY, "1");
    const readBack = localStorage.getItem(TOUR_STORAGE_PROBE_KEY);
    localStorage.removeItem(TOUR_STORAGE_PROBE_KEY);
    available = readBack === "1";
    if (!available) errorMessage = "round-trip mismatch";
  }
} catch (err) { available = false; errorMessage = err instanceof Error ? `${err.name}: ${err.message}` : String(err); }
```

The probe key is deliberately separate from the state key *"so a probe failure can't corrupt persisted
progress"* (`:1049-1053`); the failure path emits a breadcrumb, a `captureMessage`, **one** toast per
session guarded on `globalThis`, and downgrades `persistState()` to a no-op so the feature keeps
working in memory (`:1068-1082`). It distinguishes *unavailable* from *corrupt* and treats them
differently (`:1168-1179`) — a corrupt payload does **not** toast, because the user is not stuck.
**Zero of the five sibling repos probe their storage at all; five of five write and hope.**

Also exemplary:

- **`App.tsx:174-178`** — the tri-state composed at the call site:
  `const [consented] = useState(hasUserConsented); const [isVersionBump] = useState(() => { const stored = storedConsentVersion(); return stored !== null && !hasUserConsented(); });`
  Two readers, one derived fact, computed once in a lazy initialiser so it cannot flap.
- **`useWhatsNewIndicator.ts:56-59`** — the silent baseline, with the invariant in the docstring
  (`:16-21`): *"On a fresh install (`null`) we record the current version as a silent baseline and
  show no dot — there's nothing 'new' relative to a prior version the user never ran."*
- **`onboardingSlice.ts:255-273`** — `offerTourHandoff`, a one-time offer done correctly: a persisted
  `tourHandoffOffered` latch checked first, a precondition that the thing being handed off actually
  exists (`onboardingCreatedPersonaId`), and a check that the user has not already satisfied the goal
  another way — three guards, each with a comment saying which failure it prevents.
- **`acceptTourHandoff` (`:275-283`)** — pre-completing a step the user did not click, *with the
  justification*: *"Honest — the step's outcome is genuinely satisfied."* Marking something done on a
  user's behalf is legitimate exactly when you can write that sentence.
- **`AccountSettings.tsx:28`** — `useState(isTelemetryEnabled)`. The one-character difference from
  §0's defect.

### What the live stores hold

Read-only copies + a read-only harness query, 2026-08-16 21:06:

- **`app_settings`: 32 rows, 0 consent keys.** `companion_autonomous_mode = 'true'`;
  `onboarding_quest_state` present but orphaned (below). First-run acceptance and the telemetry
  preference are **not** in the database at all.
- **`settings_audit_log`: 15 rows.** `actor` is non-null on **1 of 15** (the API-key row, `'ui'`);
  the other 14 record a change with no actor — including both flips of the standing-consent switch
  (`companion_autonomous_mode` `true→false` 2026-07-26, `false→true` 2026-08-05). **The ledger exists,
  it reaches exactly one consent surface, and it cannot say who answered.**
- **`onboarding_quest_state`**: `{"milestones":{connect_credential, schedule_trigger, run_persona,
  save_memory, create_persona}, "dismissed":false, "completedAt":null, "visible":true}`, last written
  **2026-05-07**. All five milestones reached; `completedAt` still null; **zero code references** in
  `src/` or `src-tauri/src/`.
- **`desktop_connector_approvals`: 0 rows.** **`companion_tours`: 0 rows in *both* databases** — the
  split noted by [second-database](./second-database.md), still empty on both sides.
- **Live localStorage (origin `http://localhost:1420`, 80 keys):**
  `__personas_user_consent_accepted = "3"`, `__personas_telemetry_enabled = "true"`,
  `onboarding-state-v1` **absent**, `guided-tour-state.version = 4`,
  `persona-ui-system.version = 0` with `onboardingCompleted:false`, `tourCompleted:false`,
  `tourDismissed:true`, `setupCompleted:false`, `whatsNewSeenVersion:"1.1.0"`.
  Tours: `getting-started` dismissed at step 2 with 2 completed steps; the other **6** registered
  tours untouched.
- **The LevelDB copy holds the consent keys under three origins** — `http://tauri.localhost`,
  `http://localhost:1420`, `http://localhost:1430` — and an older `guided-tour-state` at
  `"version":3`, which the current code discards at `tourSlice.ts:1163`. The version discipline
  works; it is the only one here that does.

> **A measurement note, because it nearly produced a false zero.** The first LevelDB scan searched
> for the literal `__personas_user_consent_accepted` and returned **0 occurrences**, which would have
> read as "the consent key has never been written". It is Chromium's shared-key-prefix compression:
> the key is stored as the delta from its neighbour `__personas_telemetry_enabled`, i.e. as
> `user_consent_accepted`. The doctrine's "measurement truncated by its own display limit" hazard,
> in a different costume — the instrument answered a question about byte sequences while I was asking
> one about keys. Every LevelDB number above was re-derived through the live harness.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is the same omission:
> **the app can tell you what the user answered, and cannot tell you whether they were asked.** At the
> read it produces §7.A (absence is consent). At the re-ask it produces §7.B (a default overwrites an
> answer). At the substrate it produces §7.D and §7.E (an answer scoped to a WebView origin, and two
> stores racing for one fact). At the enforcement point it produces §7.C (a decision with nowhere to
> take effect). The one surface that models the third state explicitly — the What's New baseline — is
> also the only one with nothing at stake.

### 7.A — P0: a consent-version bump overwrites the telemetry answer with a hardcoded default

§0, with the replay. `FirstUseConsentModal.tsx:142` initialises `telemetryChecked` to `true`
unconditionally; `:149` writes it on Accept unconditionally. `CONSENT_VERSION` has shipped `'1'` →
`'2'` (`00ce77463`, 2026-04-04) → `'3'` (`686b2a9a7`, 2026-04-17, *"fix wrong GitHub source link"*).
`resetUserConsent()` (`:48-52`) reaches the same state deliberately, and also leaves `TELEMETRY_KEY`
in place for the next Accept to overwrite.

**Fix (deferred — not applied, per the campaign's no-destructive-applies rule; this changes what a
live surface does):** `useState(isTelemetryEnabled)` at `:142`, matching `AccountSettings.tsx:28`;
and a comment beside `CONSENT_VERSION` naming which stored answers a bump is meant to invalidate.
One-character-class change, and it closes the only defect in this document that has demonstrably
already fired in production twice.

### 7.B — P0: absence, and unreadable storage, both read as "yes"

```ts
// src/lib/telemetryPreference.ts:14-20
export function isTelemetryEnabled(): boolean {
  try { return localStorage.getItem(TELEMETRY_KEY) !== "false"; } catch { return true; }
}
```

Both branches are permissive. Measured across 4,829 files: the fail-open form
(`getItem(...) !== 'literal'`) appears **2** times; the fail-closed form (`=== 'literal'`) appears
**12** times in 10 files. The 2 are `telemetryPreference.ts:16` and `scanSweep.ts:22`, and one of
them is the privacy decision.

Consequences, in order of severity: on a fresh install the key is absent, so `main.tsx:304`
initialises Sentry and analytics **before** the modal that asks about them renders from `App.tsx:334`
(the shape [informed-consent-gate §7.A](./informed-consent-gate.md) found, and which
`personas-web/sentry.client.config.ts:3` reproduces — **2 of 2 repos with an SDK**); on a
storage-hostile profile a *written refusal* is discarded on every read; and a new WebView origin
(dev port change, dev→production build) starts from absence again.

**Fix (deferred):** the `ConsentAnswer` union from §4, with `mayCollectTelemetry()` as the only
exported boolean and both `never-asked` and `unreadable` mapping to `false`; and gate `main.tsx:304`
on `storedConsentVersion() !== null && mayCollectTelemetry()` so *not yet asked* stops meaning *yes*.

> **Two independent implementations, and they disagreed — usefully.** A whole-file regex and a
> line-oriented tokenizer agreed exactly on the **unsafe** set (2/2, identical `file:line`) and
> disagreed on the safe set: **11 vs 12**. The tokenizer was right. The regex's `getItem\([^)]*\)`
> cannot cross the nested parentheses in `getItem(storageKey(id))` and silently dropped
> `plugins/twin/CoachMark.tsx:15`. Agreement on the headline is not soundness — and the miss landed
> on the *compliant* side, which is the direction that flatters the finding.

### 7.C — P1: the consent answer has one enforcement point and no teardown

§0's second headline. **21** direct `@sentry/*` importers, **21 of 21** emitting, **1** consulting
`isTelemetryEnabled()`, **1** `Sentry.init`, **0** `Sentry.close`. The live hole is withdrawal:
`AccountSettings.handleTelemetryToggle` (`:47-55`) writes the key and swaps the analytics sink; error
reporting continues for the rest of the session, and only the *inbound* direction of that asymmetry is
documented (`sink.ts:104-113`).

There is also a path that leaves the device without passing the sink at all. `markActivation`
(`activation.ts:121-134`) routes its analytics event through `getAnalyticsSink()` — correct, and the
module docstring says so — and then calls `recordReferralOnce()` at `:132`, which invokes
`recordReferral(referrer, getInstallId())` (`api/agents/personas.ts:183`), an `@/api` door, with **no
consent check anywhere on the path**. It is **latent on this install** — `personas.referrer` is not
among the 80 live keys, so the `if (!referrer) return` at `:148` short-circuits — but it is the one
outbound call in the analytics module that the telemetry answer cannot reach, and
`getInstallId()` (`:67-80`) mints and persists a pseudonymous identifier on first call regardless of
consent state.

**Fix (deferred — security-adjacent and behaviour-changing):** put the check inside
`lib/sentry.ts`'s exported helpers, route `silentCatch` / `tauriInvoke` / the store slices through
them, and add a `Sentry.close()` (or a `beforeSend` that returns `null`) to the withdrawal handler so
withdrawal has somewhere to take effect. Move `recordReferralOnce` behind the same check.

### 7.D — P1: the answer is per-WebView-origin, absent from the database, and one of its two stores has never been written

Four sub-findings, all from live state:

1. **Three origins.** The LevelDB copy holds the consent keys under `http://tauri.localhost`,
   `http://localhost:1420` and `http://localhost:1430`. Each is an independent answer.
2. **`app_settings` holds 32 rows and no consent key.** Nothing survives a profile clear, and the
   backend cannot know whether the user agreed.
3. **`onboarding-state-v1` does not exist on this profile**, while `persona-ui-system` carries the
   same `onboardingCompleted` fact. The standalone key's docstring (`onboardingSlice.ts:100-107`)
   explains that it exists to prevent re-prompting a completed user — a job the *other* store is
   silently doing, because zustand's rehydrate runs after the slice initialiser.
4. **`persona-ui-system` is at `version: 0`** and holds five one-time answers. **1 of 8** persist
   configs in the tree declares a `version`.

**Fix (deferred):** mirror both consent answers to `app_settings` with
[client-state-persistence](./client-state-persistence.md)'s mirror pattern (§6), keyed off a
`hadLocalConsent` bit captured at `main.tsx` beside the existing `hadLocalAppearance`; delete one of
the two onboarding stores; give `persona-ui-system` a `version` and a `migrate`.

### 7.E — P2: the only reader of the consent state outside the modal is a developer testing surface

`AdminSettings.tsx` is the sole consumer of `CONSENT_KEY` / `hasUserConsented` / `resetUserConsent`
outside `FirstUseConsentModal` itself. Its own copy: title *"Admin"*, subtitle *"Development tools and
testing utilities"*, hint *"Reset the first-use consent modal to test onboarding"*. The affordances
are correct in isolation — `useConfirmClick` arms and auto-reverts, and the reset is followed by an
explicit reload button — but a user looking for "what did I agree to, and can I change it" has
nowhere to go. The one sibling with a revoke path puts it on the public cookie-policy page
(`personas-web/CookieSettingsButton.tsx:15` ← `app/legal/policies/CookiePolicy.tsx:95`), user-facing
and cross-tab-synchronised.

**Fix (deferred):** a Settings → Account section listing each one-time answer, its version, and its
date, with a per-item control, writing both grant and withdrawal to `settings_audit_log` with a
non-null `actor`.

### 7.F — P2: one-time answers are written with a swallowed catch, next to a probe that would have caught it

`persistConsent` (`:54-58`) and `setTelemetryEnabled` (`telemetryPreference.ts:23-27`) both end
`catch { silentCatch(...) }`. `onboardingSlice.persistOnboarding` (`:135-142`) does the same. The
correct implementation is in the same store directory (`tourSlice.ts:1084-1141`) and is used by
exactly one feature. **0 of 5 sibling repos probe either** — this is a lead, not a norm, and it is
the strongest single thing in this leaf.

### 7.G — P2: a stranded one-time answer

`app_settings['onboarding_quest_state']` — 5/5 milestones, `completedAt: null`, `dismissed: false`,
`visible: true`, last written 2026-05-07 — has **zero** readers or writers anywhere in `src/` or
`src-tauri/src/`. The key survives only as `settings_keys.rs:227`, registered in `ALLOWED_KEYS`, in
`audit_category` (`:1252` → `"config"`) and in three other lists. A one-time gate that nobody can
finish, nobody can dismiss, and nobody renders. **Do not delete the row**; decide whether the feature
returns and, if not, retire the key through `deprecated_replacement` so the next reader is told what
happened.

### 7.H — P3: the version-bump sentence is the one string in the modal that is not translated

`:172-175`. Every other string is `c.*` (67 keys under `consent` in `en.json`). The untranslated one
renders only on the re-ask branch — the surface whose entire purpose is to explain a change to a user
who has already agreed once, in a 14-locale app.

### 7.I — What this path CLEARED

Four things that looked like defects and are not:

1. **`CONSENT_KEY` has exactly one writer.** A whole-repo scan (`src`, `src-tauri/src`, `scripts`,
   `tests`, `e2e`, `index.html`) found no test helper, no migration and no Rust `eval` that writes it
   — unlike `personas-web`, where an e2e spec writes the consent key directly
   (`e2e/cookie-consent.spec.ts:38`) and a `?tour=1` URL parameter consumes the one-time tour flag
   (`TourLauncher.tsx:79-82`). **No consent gate here is answered by a URL, a test or a migration.**
2. **The silent baseline in `useWhatsNewIndicator` is correct, not a stolen answer.** It records a
   version, not a permission; it shows nothing; and the reasoning is written down at `:16-21`. It is
   the right way to collapse a tri-state when you must.
3. **The tour's version discipline works, and the live data proves it.** The LevelDB copy still holds
   a `"version":3` payload from April; `loadPersistedState` (`:1163-1166`) discards it and the live
   profile is at 4. A versioned document with a discard-on-mismatch policy did exactly what it was
   built to do, silently, across a schema change.
4. **`HIGH_RISK_APPS` has been widened.** [informed-consent-gate §7.B](./informed-consent-gate.md)
   reported `new Set(['desktop_docker'])`; it is now
   `new Set(['desktop_docker', 'desktop_terminal'])` (`DesktopDiscoveryStep.tsx:47`). The shell-spawn
   + file-write connector is badged. `desktop_vscode` still spawns processes unbadged, and
   `handleApproveApp` (`useOnboardingState.ts:159-176`) still grants every capability in the manifest
   while displaying none — that half is unchanged and stays that path's backlog, not this one's.

---

## 8. Gaps in the primitives

1. **No shared storage-availability probe.** `probeTourStorage` is 58 lines of correct, hard-won
   handling of a real class of user environment, private to one feature, and every other one-time
   writer in the tree — including the consent gate — reimplements the naive version. The extraction
   is mechanical: `probeWebStorage(): 'ok' | 'unavailable'`, cached, breadcrumbed, one toast, beside
   the `safeLocalGet`/`safeLocalSet` helpers [client-state-persistence](./client-state-persistence.md)
   already asks for.
2. **`settings_keys.rs`'s `<KEY>_DEFAULT` convention cannot express a consent key, and this is a real
   conflict between two golden paths.** [app-settings-store](./app-settings-store.md) §2 requires
   every key to declare *"what does unset mean"* with *"exactly one answer"*. For a consent key the
   only correct answer is **"unset means the question has not been asked, and no behaviour may be
   derived from it"** — a sentinel, not a value. Registering a consent key under the current
   convention forces the author to pick `"true"` or `"false"` as the default, which is precisely the
   tri-state collapse P1 forbids. The registry needs a way to say `NO_DEFAULT`.
3. **No consent record type.** `settings_audit_log` is the right table and has the right columns, but
   `actor` is nullable and null on 14 of 15 rows, so it cannot distinguish a human answer from a
   background write. `brainiac` has the shape worth copying twice over —
   `provenance(actor_kind text -- human | agent | pipeline)` (`migrations/0001_init.sql:52-61`) and
   `governance.rs`'s `applied_by.is_some()` ⇒ `"approved"` / `None` ⇒ `"auto_approved"` — and applies
   it to knowledge, not consent, in **0 of 5** repos.
4. **No re-ask policy primitive.** A version bump is a re-ask, and the code has no way to declare
   which stored answers it invalidates. Today the policy is implicit in whichever `useState` literal
   each control happens to carry, which is how §7.A happened.
5. **Nothing binds a one-time answer to the origin it was given under.** The answer is written to
   whichever `location.origin` is running, and neither the key nor any type records that. A durable
   mirror in `app_settings` would make this visible for the first time — and would immediately raise
   the question of whether a dev-build answer should count for a production build, which nobody has
   had to decide because nobody could see it.
6. **No "consent required before this runs" boundary.** Every effect that must wait for the answer —
   Sentry init, analytics subscription, the install-id mint, the referral post — decides for itself,
   at module scope, by reading a boolean. A single `whenConsented(fn)` gate that queues until the
   answer exists and re-runs on withdrawal would collapse §7.B and §7.C into one mechanism.

---

## 9. The missing gate

**The condition this signal is a proxy for:** *the answer to a one-time consent question cannot reach
the behaviour it governs.* In this repo that condition wears a very specific costume — a module that
imports the telemetry SDK directly instead of going through the one wrapper where a consent check
could live, so its emissions are governed by whether a global initialisation happened rather than by
what the user said. **An adopting repo must re-derive its own proxy.** Where telemetry is a
server-side SDK the anchor is the SDK's import in a request handler; where it is a `<script>` tag the
anchor is the tag itself and a census cannot see it at all; where the product has no telemetry the
condition is present in a different consumer entirely (a feature flag, a sync client) and this pattern
scores **zero** while the leaf's real defect — §7.A's re-ask overwrite — sits untouched. The
**portable** half is the head, the anti-patterns and the verification *intent*: count the paths from
the gated behaviour back to the stored answer, and fail when any path does not pass through it.

**Why this signal and not the more obvious ones**, with the numbers that made me refuse each:

- **"A consent read whose absent branch is permissive"** — `getItem(...) !== 'literal'`. This is the
  leaf's sharpest *semantic* condition and I wanted it to be the rule. Two independent
  implementations, agreeing exactly: **2 matches in 2 files**, against 12 compliant. Both true
  positives. **Refused** — a 2-match ratchet buys nothing, is one refactor away from a structural
  zero-match failure, and the doctrine's own precedent (a 5-match `window.confirm` rule) declined at
  more than double the population. Documented as §7.B instead, which is where it belongs.
- **"A `persist()` config with no `version`"** — **7 of 8**, and it is a genuine defect for the store
  holding five one-time answers. **Refused on precision and population:** one of the 8 is a JSDoc
  `@example` block (`dedupedStorage.ts:45`) that **both** of my independent counters reported, in the
  same direction — a shared false positive is exactly the doctrine's warning about false agreement —
  and a 7-match rule over 8 possible matches is a constant, not a ratchet.
- **"A one-time flag latched in `useState`"** — **5 matches in 5 files**, and 2 of the 5
  (`GlyphCinemaLayout`, `MastermindPage`) are legitimately per-mount. **~60% precision at 5 matches.
  Refused.**
- **"A durable one-time key written with a swallowed catch"** — this is §7.F and it is real, but the
  anchor is indistinguishable from every other localStorage write, and
  `raw-web-storage` (`client-state-persistence`, 72 files / 186 matches) already ratchets that whole
  population toward a wrapper. **Refused for overlap with a rule that is already pulling in the right
  direction.**
- **Overlap check against the existing registry**, computed file-by-file against my population:
  `bindingless-catch-on-io` (`swallowed-error-telemetry`) **1/19**; `raw-web-storage`
  (`client-state-persistence`) **3/19**; `module-scope-install-latch` (`hmr-safe-singletons`)
  **1/19**; `hand-rolled-module-cache` (`shared-fetch-cache`) **1/19**;
  `render-time-redaction-toggle` (`secret-and-pii-redaction`), `unconsented-irreversible-door`
  (`informed-consent-gate`), `undeclared-tier-branch`, `read-failure-as-empty-value`,
  `stateless-disclosure-control`, `env-default-conflates-unset-with-empty`,
  `shallow-wrapped-property-selector` — **0/19 each**. Highest single-rule overlap **16%**; the
  precedent decline threshold in this corpus was 83%.

**Precision: 19/19, hand-read.** Every file in the population calls at least one emitting Sentry API
(`captureException` / `captureMessage` / `addBreadcrumb` / `metrics.count` / `setTag` / `withScope`);
none calls `isTelemetryEnabled`. Two of them state the dependency they are relying on in a comment —
`errorRegistry.ts:695` and `useTranslatedError.ts:43` both say *"safe before Sentry.init (no-op)"* —
which is the finding rather than an exoneration: the safety is inherited from a global that
withdrawal never touches.

**Honest weakness, stated because it is the doctrine's own warning:** the positive control returns
**1**. The partition is exact — 21 raw anchor matches = 19 violating + 1 compliant (`main.tsx`) + 1
excluded chokepoint (`lib/sentry.ts`) — which is the strongest form the doctrine asks for, but with a
compliant side of one file the negative lookahead is doing nearly all of the discriminating. The
honest reading is that **the compliant form is nearly extinct in this repo**, which is exactly what
§0's second headline claims and what the rule exists to reverse. A reader should treat the control as
evidence of the finding rather than as evidence that the matcher discriminates well.

**Correct end state is 0** — every module routing through a consent-aware `@/lib/sentry` facade — at
which point **delete this rule** rather than baselining it at zero; the runner treats a zero-match
rule as broken, deliberately.

**Where it runs.** `lefthook.yml:74-75` — the `golden-path-census` **pre-push** job runs
`npm run census:check`, added 2026-08-16 with the note that the census had been *"enforced NOWHERE"*
before that. It is also inside `npm run check` (`package.json:52`). It is **not** in `ci.yml`, which
is correct for a repo whose CI is currently red on ten pre-existing failures — a gate that only runs
in CI runs nowhere, and this one runs on every push from the machine that made the change.

**Fail-loud, verified by injection** (six modes, all fire, exit 1 in every case):
floor raised to 99999 → *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a
non-matching literal → *"matched zero files anywhere"* **and** a silent-drop drift error; baseline
`{5,5}` → rise; baseline `{40,40}` → silent drop; a `baseline` added to the control → `validateRule`
rejects it before any file is walked; a stale `exclude` path → *"the exemption is stale"*. Clean run:
exit 0.

```json
{
  "id": "consent-bypassing-telemetry-import",
  "goldenPath": "docs/concepts/golden-paths/first-use-consent-gate.md",
  "title": "A module reaches the telemetry SDK directly, so the one-time consent answer cannot reach it",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^(?![\\s\\S]*isTelemetryEnabled)[\\s\\S]*?\\bfrom\\s*['\"]@sentry/",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "A module under src/ imports the telemetry SDK directly (from '@sentry/…') and the whole file never consults isTelemetryEnabled(). PROXY FOR the stack-free condition: the answer to a one-time consent question cannot reach the behaviour it governs. Measured 2026-08-16 at e3c5e0d7f: 21 files import @sentry/* ; the rule matches 19, the positive control matches 1 (main.tsx, which owns the boot gate), and 1 is the excluded chokepoint — 19 + 1 + 1 = 21, an exact partition of the anchor. PRECISION 19/19 hand-read: every matched file calls at least one emitting Sentry API (captureException / captureMessage / addBreadcrumb / metrics.count / setTag / withScope) and none consults the preference; isTelemetryEnabled() has exactly 2 call sites in 4,829 files, and Sentry.close() has 0, so a mid-session withdrawal tears down nothing. Two matched files SAY they are relying on the global (errorRegistry.ts:695 and useTranslatedError.ts:43, both 'safe before Sentry.init (no-op)') — that is the finding, not an exemption. ignoreCommentLines is FALSE on purpose: the match is file-scoped and anchored at index 0, so the comment filter would look at line 1 and drop the count for any file that grows a JSDoc header. KNOWN WEAKNESS: the control returns 1, so the negative lookahead does nearly all the discriminating — read it as evidence that the compliant form is nearly extinct, which is what the rule exists to reverse. DO NOT gate 'every emitter must check consent' instead: that is the destination-defaults trap — the fix is a consent-aware facade at src/lib/sentry.ts, and this rule ratchets callers toward it. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): this repo spells 'can emit telemetry' as a bare-specifier import of a JS SDK and spells the consent answer as one exported predicate. Where telemetry is a script tag, a server SDK, or a build-time integration, this pattern scores ZERO while the condition is present."
  },
  "exclude": [
    { "path": "src/lib/sentry.ts", "reason": "the chokepoint itself — the only Sentry.init in the tree, and where the consent check belongs" },
    { "path": "src/main.tsx", "reason": "owns the boot gate; it is one of only two call sites of isTelemetryEnabled in 4,829 files" }
  ],
  "baseline": { "files": 19, "matches": 19 },
  "floor": 1500
}
```

**The positive control** (merge with `baseline` omitted — a control that carries one is rejected by
`validateRule`, verified by injection):

```json
{
  "id": "consent-bypassing-telemetry-import-positive-control",
  "goldenPath": "docs/concepts/golden-paths/first-use-consent-gate.md",
  "title": "CONTROL: the same anchor, pointed at the compliant form",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^(?=[\\s\\S]*isTelemetryEnabled)[\\s\\S]*?\\bfrom\\s*['\"]@sentry/",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "CONTROL for consent-bypassing-telemetry-import. Same anchor, opposite verdict: a direct @sentry import in a file that DOES consult isTelemetryEnabled(). Measured 1 file (main.tsx), which together with the rule's 19 and the excluded chokepoint partitions the anchor's 21 raw matches exactly. A control of 1 is itself the finding — the compliant form is nearly extinct — and it means the negative lookahead, not the anchor, carries the discrimination. Re-measure this control before trusting the rule in any adopting repo."
  },
  "floor": 1500
}
```

**What the census cannot express here, and what to build instead.** The three largest findings in this
document are all things the runner cannot see, because it ratchets a count of something *present*:

- ***"a version bump overwrites the previous answer"* (§0/§7.A) is a state-machine property, not a
  token.** No regex distinguishes `useState(true)` in a first-run modal from `useState(true)`
  anywhere else. The right instrument is a **unit test on the modal**, and it is five lines:
  seed `CONSENT_KEY='2'` and `TELEMETRY_KEY='false'`, render, click Accept, assert
  `isTelemetryEnabled() === false`. That test would have failed on 2026-04-04 and again on
  2026-04-17. **The general form worth building once for the corpus: for every gate carrying a
  version literal, a re-ask test that asserts each stored answer survives a bump.**
- ***"`onboarding-state-v1` has never been written"*** is a runtime fact about one profile. Nothing
  static sees it. The instrument is a startup assertion or a health-panel row that reports, for each
  registered one-time key, whether it exists — and flags any fact persisted in two stores at once.
- ***"the consent answer is absent from `app_settings`"*** is an **absence**, which the census cannot
  assert by construction. The instrument is a parity check in the shape of `check-csp-hosts.mjs`:
  enumerate the one-time keys the frontend writes, assert each has a registered mirror in
  `settings_keys.rs`, and **exit 2 if it finds zero keys to check** so it cannot pass vacuously.
  [client-state-persistence](./client-state-persistence.md) §9.3 already specifies exactly this
  script for a wider population; this leaf is its highest-stakes consumer and a reason to build it.

---

## 12. Corrections to the brief

The brief was right about the subject and wrong or incomplete on six specifics. Recorded per the
doctrine, since the corrections are the deliverable.

1. **"The spine says CONVERGED. Treat it as a claim." — the claim fails, and it fails on the first
   clause.** A *blocking* one-time acceptance exists in **0 of 5** sibling repos. The only consent
   gate anywhere in the set is `personas-web`'s dismissible bottom banner
   (`CookieConsent.tsx:51`, no overlay, no focus trap, `✕` = `accept("essential")` at `:98`);
   `brainiac` declines to have one by argued decision; `personas-cloud` is headless; `vibeman` and
   `ascent` have non-blocking progress surfaces. **Personas' `onClose={noop}` modal is the only
   implementation of this leaf's situation in six repositories.** Downstream, `CONSENT_VERSION`-style
   versioning is **0 of 5**, so P2 — the clause that carries this document's headline — has **no
   external warrant at all** and is labelled an untested invention in the head. What *is* convergent
   is the failure side: consent stored only in one browser's localStorage **5 of 5**; a consent ledger
   with an actor **0 of 5**; a storage probe **0 of 5**; an SDK initialised before consent is known
   **2 of 2 repos that have an SDK**; an SDK de-initialised on withdrawal **0 of 5**. **This is the
   eighth CONVERGED label tested in this campaign and the eighth to fail** — at some point the label's
   prior is the finding.
2. **"Sentry is initialised at module scope, and 0 of the 2 repos with a consent banner gate their
   error-SDK init on it. That is a convergent defect, already recorded." — confirmed, and it
   understates the problem by one direction.** The recorded half is *init before consent*. The half
   nobody has recorded is *no de-init after withdrawal*: **0 `Sentry.close` call sites in 4,829
   files**, and `0 of 5` siblings de-initialise either. Turning telemetry off in Settings stops usage
   analytics and leaves error reporting live until restart, across **21** modules. The brief's framing
   made this look like a startup-ordering bug; it is a withdrawal bug, and withdrawal is the half a
   user actually exercises.
3. **"Consent storage: four substrates, no ledger." — the count is right and the ledger claim is
   wrong.** `settings_audit_log` exists, holds **15** rows with `(category, setting_key, action,
   before_value, after_value, actor, created_at)`, and **already contains a consent surface**: both
   flips of `companion_autonomous_mode` (`true→false` 2026-07-26, `false→true` 2026-08-05). The
   correct statement is sharper and more useful: **there is a ledger, it reaches exactly one of the
   consent substrates, and `actor` is null on 14 of its 15 rows** — so it cannot distinguish a human
   answer from a background write, which is the property that would have made it worth having. And
   the substrate count is **five**, not four, once `app_settings['onboarding_quest_state']` is
   included — a durable one-time answer with 5/5 milestones, `completedAt: null`, and **zero code
   references anywhere in the tree** (§7.G).
4. **"Onboarding grants every capability in the fetched manifest, displaying none; the risk badge
   named one app until 2026-08-16." — the first half holds, the second is stale.**
   `handleApproveApp` (`useOnboardingState.ts:159-176`) is unchanged. `HIGH_RISK_APPS` is now
   `new Set(['desktop_docker', 'desktop_terminal'])` (`DesktopDiscoveryStep.tsx:47`) — the
   shell-spawn-plus-file-write connector is badged, and `desktop_vscode` (ProcessSpawn + FileRead +
   NetworkLocal) is not. Reporting it as one app would have been wrong. It also is not this leaf: a
   capability grant is per-connector and re-askable, so it stays
   [informed-consent-gate §7.B](./informed-consent-gate.md)'s backlog.
5. **"`AUTOAPPROVE_ALLOWLIST` was deleted — a one-time toggle silently widened to 53 actions." —
   true, and this leaf adds the part that makes it worse: the widening is invisible in the one place
   that records it.** `companion_autonomous_mode` is the *only* consent answer in this repo that
   reaches an audit table at all, and its two rows carry `actor: null`. The ledger recorded that the
   standing consent was re-granted on 2026-08-05 and cannot say by whom — five days before the
   allowlist deletion changed what that grant means. **An audit row that survives a semantic change to
   the thing it audits is not a record, it is a timestamp.**
6. **"Enumerate the once-only gates … and whether any gate is recorded as answered without the user
   answering it." — yes, and it is the headline, but not where anyone was looking.** No test helper,
   URL parameter, migration or Rust `eval` writes a consent key in this repo (§7.I.1) — unlike
   `personas-web`, where an e2e spec writes it directly and a `?tour=1` parameter consumes the
   one-time tour flag before any interaction. The answer nobody gave here is written by the **consent
   modal itself, on the re-ask branch**: `FirstUseConsentModal.tsx:142` initialises the telemetry
   checkbox to `true` regardless of the stored preference and `:149` persists it on Accept. A user who
   opted out and then upgrades has `__personas_telemetry_enabled` rewritten from `"false"` to
   `"true"` by a click on a button labelled Accept. Two version bumps have shipped — `'1'`→`'2'`
   (`00ce77463`) and `'2'`→`'3'` (`686b2a9a7`, whose subject is *"fix wrong GitHub source link"*).
   **A hyperlink correction re-granted telemetry consent for every user who had refused it.**

**One correction offered upward, to a neighbouring path.**
[`client-state-persistence`](./client-state-persistence.md) §2 says that anything *"a user
deliberately chose … whose loss would be felt"* belongs in `app_settings` with localStorage as at most
a cache. A consent answer is the purest instance of that sentence and it is 100% localStorage today —
but **following that path literally would break this gate**, because `main.tsx:304` decides whether to
initialise telemetry at module scope, synchronously, before any IPC can resolve. The correct reading
is that path's **mirror** exception (*"only when the value must be read before React mounts — theme,
language, sidebar route"*), and the consent answer belongs on that list; it is a fourth member of a
three-item enumeration. Its own reference implementation already carries the missing half —
`bootstrapAppearanceMirror(hadLocalAppearance)` distinguishes a fresh/cleared profile from a returning
user using a bit captured at `main.tsx:36` — and the consent gate is 268 lines below that line in the
same file. Suggested edit to that path: add *"a first-use consent answer"* to the mirror-pattern
enumeration in its §2, and name the `hadLocal*` capture as the general primitive rather than an
appearance detail.
