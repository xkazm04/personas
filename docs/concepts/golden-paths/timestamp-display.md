# Golden path — Timestamp display

> Situation node: `ui-system/copy-and-vocabulary/timestamp-display` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `58d82e608`. **Recurrence 141.**
> Sweep: `display/RelativeTime.tsx`, `display/AbsoluteTime.tsx`, `hooks/utility/data/useFormattedDate.ts`,
> `hooks/utility/timing/relativeTimeTicker.ts`, `lib/utils/formatters.ts` and `display/grouping.ts` read in
> full; a **balanced-paren first-argument census of every `.toLocaleDateString(` / `.toLocaleTimeString(` /
> `.toLocaleString(` / `new Intl.DateTimeFormat(` / `new Intl.RelativeTimeFormat(` in all 4,829 `.ts`+`.tsx`
> under `src`**, hand-classified date-vs-number; **28 elapsed-time ladders located and each one read**; a
> full parse of `src/i18n/locales/*.json` (14 files, 19,112 leaf keys) for relative-time vocabulary and its
> per-locale drift; the timezone skew reproduced by **executing** V8 under `TZ=America/New_York` and
> `Europe/Prague`; and a convergence census of **`personas-web`** (Next.js, 14 locales) and
> **`brainiac/console`** (Next.js, no i18n).
> Dimensions: **ui · function · code-quality · performance**.
> **Settles:** who decides what a *moment* looks like on screen — the call site, the host operating system,
> or the app.
>
> Counts reproduce [`shared-facts.json`](../shared-facts.json) where they touch it (4,829 files). Where this
> document contradicts a sibling path or a claim handed to it, it says so in **§7.0**. Deviations become
> `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and each
clause carries its **warrant**, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics.** A stored moment is a *point on the timeline*; what a person reads is a *projection* of
> that point into a calendar, a clock, and a language. The projection needs three inputs the point does not
> carry: a timezone, a locale, and a rendering style. Code that renders a moment without supplying all three
> has supplied them anyway — from whatever ambient default was nearest — and has therefore made a decision
> it did not know it was making.
>
> **P2 — physics, and the reason P1 is not merely tidy.** Of those three inputs, **the timezone is the only
> one whose absence changes which moment is being named.** A wrong locale renders the right instant in an
> unfamiliar shape; a wrong timezone renders a *different instant*, and past events acquire future dates. A
> rendering that is off by an offset is not a style defect — it is a false statement about when something
> happened, and it is textually indistinguishable at the call site from a correct one.
>
> **P3 — physics.** *Elapsed time* and *a fixed moment* are two different questions with two different
> answers, and only one of them is a function of the present. An elapsed label is a value with a
> **shelf-life**: correct when computed, wrong a minute later, and wrong silently. A fixed moment is stable
> forever. Any layer that treats them as one thing will either freeze the label that must move or churn the
> one that must not.
>
> **P4 — physics.** The vocabulary of elapsed time — *just now*, *a minute ago*, *yesterday* — is a **closed,
> universal set that every locale already has a canonical form for**, including its plural rules and its
> word order. It is the one piece of user-facing prose a program should never author, because authoring it
> means re-deriving, per language, something the platform already knows and the translator will get subtly
> different each time.
>
> **P5 — physics.** *Not yet*, *unknown*, and *the clock disagrees with the server* are three different facts.
> An elapsed formatter that subtracts two numbers and formats the result will render the third as an
> impossible statement — a duration into the future — and the reader has no way to tell it from a real one.
>
> **P6 — ergonomics, with a measured cause.** The ambient default for a locale is the *host machine's*, and
> the ambient default for a timezone is the *host machine's*. Both are one keystroke shorter to reach than
> the app's own answer, both look correct on the author's laptop, and both are invisible in review. A
> primitive that *accepts* a locale but *defaults* to the ambient one has not concentrated the decision; it
> has relocated it to the call site and hidden it behind a plausible default.
>
> **P7 — governance.** Two display primitives that disagree about where the locale comes from will disagree
> on the same screen, in the same row, and no gate keyed on either one can see it — because each is
> internally consistent. The same holds *within* a primitive whose label and whose tooltip resolve their
> locale differently.
>
> **Scale condition.** P2 and P5 pay from the first user who is not in the author's timezone — which is the
> first user. P1, P4 and P6 pay from the second locale. P3 pays from the first list long enough that a row
> stays on screen for a minute. P7 bites as soon as more than one display primitive exists.

**Warrant evidence — a second team built the locale channel and wired it to everything except dates.**
`personas-web` (Next.js, separate remote, no shared package) and `brainiac/console` (Next.js, no i18n at
all) were censused independently. Neither has seen this document.

- **The locale channel exists and dates are not connected to it — twice, independently.** `personas-web`'s
  `src/i18n/useTranslation.ts:87` returns `{ t, language }` over **the same fourteen languages**, and of its
  **12 Date-bearing locale calls, 0 receive `language`** — while **4 pin `'en-US'` outright**
  (`src/lib/format-date.ts:15,27`, `src/lib/format.ts:58`, `sla-page/slaFormat.ts:66`). It even owns an
  app-locale→BCP-47 mapper already (`src/lib/review-voice.ts:217`) and uses it for **speech**, not dates.
  Here the ratio is **1 of 84**. Two codebases, two teams, one blind spot. **P1 and P6 are physics, and this
  is the same shape the number path measured** — `personas-web` destructures `language` at 1 of 151 call
  sites, for audio. The generalisation across both leaves: *a locale channel gets wired to words, and to
  nothing else.*
- **Hand-rolled English elapsed ladders are convergent, and so is their multiplicity.** `personas-web` has
  **5** independent ladders (`src/lib/format.ts:31`, `knowledgeDenseFormat.ts:3`, `HealthIssueRow.tsx:17`,
  `feature-voting/data.ts:176`, plus one catalog-driven); `brainiac/console` has **7**, all hardcoded English,
  including **two different exported functions both named `ageLabel`** with incompatible signatures
  (`audit-data.ts:80` takes an ISO string, `disputes-data.ts:166` takes seconds) — and a comment at
  `audit-data.ts:78` acknowledging the fork. This repo has **28**. Three codebases, three scales, one idiom.
- **`Intl.RelativeTimeFormat` is used ZERO times in both siblings.** The platform ships the exact answer to
  P4 and nobody reaches for it. This repo reaches for it **3 times out of 28 ladders** — barely ahead, and
  the ahead-ness is the finding, not a defence.
- **Nobody uses a date library.** `date-fns`, `dayjs`, `luxon`, `moment`, `@internationalized/date`:
  **zero in all three repos.** Every one hand-rolls on the `Date` builtin. This is not a gap to close — it
  is evidence that the *platform* primitives are the destination, not a dependency.
- **The unclamped future label is reinvented in all three.** `personas-web`'s `HealthIssueRow.tsx:18-20`
  renders **`-3m ago`**; `brainiac`'s `disputes-data.ts:166` renders **`-300s`**; this repo's
  `PersonaHealthDashboard.tsx:74` and `StatusPageView.tsx:45` render **`-45s ago`**. A defect three
  independent teams reach by different routes is a property of the problem. **P5 is physics.**
- **The local-parts-then-UTC-serialize off-by-one is reinvented.** `personas-web`'s
  `usage-view/usageViewData.ts:15-23` mutates **local** date parts with `setDate()` and then reads the
  **UTC** day with `.toISOString().slice(0,10)`. This repo does the same at `src/lib/types/timeRange.ts:33`
  and `OverviewFilterContext.tsx:38`. **P2 is physics.**

**Where convergence contradicts this repo — report it.**

- **`personas-web` has a better answer to P5 than this repo has anywhere.** `src/lib/format.ts:28` defines
  `FUTURE_SKEW_TOLERANCE_MS = 60_000`; past that tolerance `:36-64` **abandons relative rendering entirely**,
  returns an absolute UTC date, and fires a once-per-session Sentry breadcrumb. This repo has no skew policy
  and no skew telemetry in any of its 28 ladders — the closest is one clamp with a good docblock
  (`LiveRoadmapStatusPill.tsx:22-40`). Adopt the sibling's shape.
- **`personas-web` pins the timezone deliberately and tests it; this repo does not.**
  `src/lib/format-date.ts:5-33` parses `iso + "T00:00:00Z"` and formats with `timeZone: "UTC"`, carries a
  comment naming the exact off-by-one hazard, and has a regression test at `format-date.test.ts`. This repo
  has **3** `timeZone:` pins total and **no date test at all** in `formatters.test.ts` (§7.H).

**What did NOT converge — this repo's own investment.** A **date display component** (`<RelativeTime>` /
`<AbsoluteTime>`) exists in neither sibling: `personas-web`'s de-facto primitive is a plain 30-call-site
function plus 7 inline renders that bypass it, and `brainiac`'s is a one-liner **copy-pasted into 5 files**.
So is a **shared self-scaling ticker**: `personas-web` runs 3 independent timers with the page-visibility
guard written three times, and `brainiac` runs **none at all**, so every relative label there goes stale and
stays stale. This repo built both, and both are genuinely ahead — which is precisely why the finding below
is that they are ahead *and locale-blind*. Adopt the principle; note that this repo already owns the
machinery the others are missing and has not pointed it at the right locale.

---

## 1. Trigger

- "show when this ran", "add a *last updated* column", "put the created date in the header"
- "this says 2 hours ago and it just happened", "the date is a day off", "it finished in the future"
- "the timestamp doesn't refresh until I switch tabs", "the *3s ago* label is frozen"
- "group these rows by day", "show the date only if it isn't today"
- **If you are about to type `new Date(` next to a field ending in `_at`, `.toLocaleDateString(`,
  `.toLocaleTimeString(`, `new Intl.DateTimeFormat(`, `Date.now() - `, a `/ 60_000` next to an `m`, or the
  string `' ago'`** — you are in this situation.
- If you are about to write a `tickFormatter` / `labelFormatter` for a time axis, you are in this situation.

You are **not** in this situation for: a duration that is not anchored to a moment (`"took 2m 30s"`,
`"timeout after 30s"` — that is a quantity with a unit, see the boundary below), a timestamp written into an
LLM prompt / log line / exported filename, a `setTimeout` delay, or a value being persisted.

Boundaries with the neighbouring paths, stated because four leaves touch the same `created_at`:

- **[`timestamp-storage.md`](./timestamp-storage.md)** owns the *shape of the string* and everything that
  happens to it before it reaches a component: the DDL default, the Rust writer, the SQL predicate, and
  `normalizeTimestamp` at the read boundary. This path owns what happens **after** a valid instant is in
  hand. The seam has a defect on it and both paths name it: `AbsoluteTime` does not call `normalizeTimestamp`
  (§7.C). Treat that as one bug with two owners, not two bugs.
- **[`number-and-cost-formatting.md`](./number-and-cost-formatting.md)** owns **durations** —
  `formatDuration`, `formatElapsed`, `formatCountdown`, `formatInterval` — because a duration is a quantity
  with a unit, not a moment. It also owns every digit-grouping and separator decision. This path owns the
  rendering of a *moment*: elapsed-since-now, and absolute date/time. The seam is `formatRelativeTime`, which
  lives in that path's module and produces this path's output; §7.F of that document logged it and routed the
  fix to i18n. **This path claims the moment-rendering half and proposes the concrete fix.**
- **[`i18n-string-authoring.md`](./i18n-string-authoring.md)** owns the *words in a sentence around* a
  timestamp. This path owns the elapsed vocabulary itself — and argues it should not be catalog copy at all
  (§8 Gap 2, P4).

---

## 2. The one way

**Never let the host machine decide.** A rendered moment takes three inputs and you must supply two of them
explicitly: the **app's active language** and the **rendering style**; the timezone is the viewer's local
zone and is correct *only* because the instant you hand in is unambiguous. So: get the instant right first
(a real epoch, normalized per [`timestamp-storage.md`](./timestamp-storage.md) — never a zone-less string),
then decide which of exactly **two** questions you are answering. If the reader wants *how long ago*, render
`<RelativeTime timestamp={x}/>` — it live-updates off the one shared self-scaling ticker, so the label is
never stale and never spins its own timer. If the reader wants *when exactly*, render
`<AbsoluteTime timestamp={x} variant="datetime|date|time|compact"/>`. **And then stop** — do not call
`.toLocaleDateString()`, do not construct an `Intl.DateTimeFormat`, do not write a fourth `${mins}m ago`
ladder, and never pass `undefined` or `[]` as a locale (both mean *"whatever locale the operating system
is set to"*, which is not the language the user picked in this app — measured here at **76 sites**). Outside
JSX, call `formatRelativeTime` / `formatTimestamp`; in a non-React module take the language as a parameter.
Clamp the future: `Math.min(0, then - Date.now())` before you bucket, because clock skew, a resumed laptop
and a UTC-misparsed string all produce a moment that has not happened yet, and an unclamped subtraction
renders it as `-45s ago`. **The two primitives above are the destination and they are not correct today** —
both resolve their locale from the host OS and each holds *two different* locale policies between its label
and its tooltip (§7.A). Fixing that is one edit at each primitive and it is the highest-leverage change in
this document; until it lands, routing a call site to the primitive still buys you correctness of *instant*,
of *cadence*, and of *style*, and defers only the language.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/features/shared/components/display/RelativeTime.tsx`** — `<RelativeTime timestamp fallback showTooltip className/>` | The **elapsed** primitive. **100 tags / 86 files.** Normalizes the backend string at `:30` (the only display primitive that does), subscribes to the shared ticker at `:34` so the label refreshes without a local timer, `memo`-wrapped. **Locale defect:** its label is hardcoded English and its tooltip (`:38`) is the host OS. |
| **`src/features/shared/components/display/AbsoluteTime.tsx`** — `<AbsoluteTime timestamp variant fallback showRelativeTooltip className/>` | The **fixed-moment** primitive. **37 tags / 31 files.** Four presets in the `FORMATS` map (`:10-16`) so a dense table and a detail drawer agree. **Two defects:** `Date.parse(timestamp)` raw at `:46` (no `normalizeTimestamp` — §7.C), and `new Intl.DateTimeFormat(undefined, …)` at `:51` (host OS, unmemoized, per render). |
| **`src/hooks/utility/timing/relativeTimeTicker.ts`** — `useRelativeTimeTick(ms)` / `useFixedTicker(cadenceMs)` | **One timer for the whole app**, firing at the finest cadence any live subscriber needs and re-rendering every subscriber on the same tick. Self-scales with age (`cadenceForAge`: 1s under a minute, 30s under an hour, 5m beyond). Stops entirely at zero subscribers. This is the answer to P3 and it has **2 consumer files** (§7.D). |
| **`src/lib/utils/formatters.ts:30` — `normalizeTimestamp(s)`** | The read-boundary adapter for the zone-less SQLite shape. Owned by [`timestamp-storage.md`](./timestamp-storage.md); named here because **every** display path must go through it and one primitive does not. |
| **`src/lib/utils/formatters.ts:41` — `formatRelativeTime(iso, fallback, { dateFallbackDays })`** | The shared elapsed ladder for non-JSX callers. **69 calls / 54 files.** Normalizes. `dateFallbackDays` switches to an absolute date past N days, which is the right behaviour and is used by only 5 callers. English-only (§7.B). |
| **`src/lib/utils/formatters.ts:36` — `formatTimestamp(iso, fallback)`** | Absolute datetime for non-JSX callers. **21 calls / 12 files.** Normalizes; host-OS locale. |
| **`src/i18n/useTranslation.ts:325` — `const { t, tx, language } = useTranslation()`** | Where the app's active language comes from in a component. Returns a stable identity per language, so destructuring `language` costs nothing. **1,497 files call this hook; 20 destructure `language`.** |
| **`src/lib/utils/formatters.ts:21` — `activeLanguage()`** | `useI18nStore.getState().language` — the non-React reader, added 2026-08-14 by the number-formatting fix. **Currently module-private**; §8 Gap 1 asks for it to be exported, because it is the whole fix for this leaf too. |
| **`Intl.RelativeTimeFormat(language, { numeric: 'auto' })`** | The platform's answer to P4: `"4 minutes ago"` / `"il y a 4 minutes"` / `"4分前"` / `"منذ ٤ دقائق"`, with each locale's plural rules and word order, **and zero translation keys**. Used **3 times** here, **0 times** in either sibling. |
| **`src/features/shared/components/display/grouping.ts:30` — `timeGroupKey(ts, now)`** | Day/week/month bucketing for `UnifiedTable`'s `groupBy`. Correctly uses **local** calendar parts (`:34,:38,:39`) — the right choice for "is this today *for the reader*". Copy this, not `toLocaleDateString()` as a key. |

**Explicitly NOT primitives.** `useFormattedDate` (`src/hooks/utility/data/useFormattedDate.ts`) is a
memoized `toLocaleString` wrapper with **one external call site** (`PersonaOverviewColumns.tsx:40`) that
passes no locale; it is a fourth locale policy for the same question and should be deleted, not adopted
(§8 Gap 5). `new Date(x).toLocaleDateString()` as a **grouping key** (`KnowledgeAtelier.tsx:41`) is both
locale-dependent and timezone-dependent — use `timeGroupKey`. A local `const ago = (iso) => …` ladder is not
a primitive; there are 28 of them.

---

## 4. Steps

1. **Get a trustworthy instant first.** If the value came from the backend it is a string of unknown shape —
   run it through `normalizeTimestamp`, or hand it to a primitive that does. Skipping this is not a display
   bug, it is a **wrong instant**, and it is off by your UTC offset in the direction that makes past events
   look future (§7.C). This step belongs to [`timestamp-storage.md`](./timestamp-storage.md); it is step 1
   here because nothing below it can be right if it is skipped.
2. **Answer exactly one of two questions.** *How long ago?* → `RelativeTime`. *When exactly?* → `AbsoluteTime`.
   If you want both, that is what the primitives' tooltips are for — do not render two labels.
3. **Pick the `variant`, not the format string.** `datetime` / `date` / `time` / `compact` are the four shapes
   this app has agreed on. Reaching for `{ month: 'short', day: 'numeric' }` at a call site is how a fifth
   shape gets born; there are **42** such option bags across 32 files today.
4. **Never write a locale argument that means "ask the OS".** Empty, `undefined` and `[]` are the same
   decision spelled three ways, and it is the wrong one in an app that ships 14 languages and mirrors the
   chosen one into the backend (`i18nStore.ts:94`). If you genuinely need a raw `Intl` call, pass
   `language` from `useTranslation()` — `LiveRoadmapStatusPill.tsx:38` is the one site that does.
5. **For an elapsed label, take the vocabulary from the platform, not from the catalog.**
   `new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-4, 'minute')`. The catalog currently
   holds **48 strings across 14 namespaces** encoding this one four-rung ladder, translated into 13 locales
   each — and they **disagree with each other per locale** (§7.B). Adding a fifteenth namespace is not a
   translation; it is a fork.
6. **Clamp the future before you bucket.** `const diff = Math.min(0, then - Date.now())`. Then decide whether
   a large positive skew should abandon relative rendering entirely — `personas-web`'s
   `format.ts:28-64` does, with telemetry, and it is the best answer any of the three repos has.
7. **Let the label live-update through the shared ticker, never a local `setInterval`.** `RelativeTime` does
   this for you. If you need a raw pulse, `useFixedTicker(cadenceMs)`. A hand-rolled 1s interval is a timer
   the app cannot coalesce, cannot stop, and cannot slow down as the label ages — there are 13 of them.
8. **And then stop.** No `toLocaleDateString`, no `Intl.DateTimeFormat`, no twenty-ninth ladder, no
   `useState(() => relativeTime(x))` freeze, no `${d}d ago` template.
9. **Ask the type question before reaching for a gate.** The largest deviation class in this document is a
   *default value*, not a habit — see the type-over-gate answer.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `.toLocaleDateString()` / `.toLocaleTimeString()` / `new Intl.DateTimeFormat(undefined, …)` / `…([], …)` | **76 sites.** All four spell *"use the operating system's locale"*. A user who set the app to Japanese on an en-US laptop reads `5/24/26`; a user who set it to English on a German laptop reads `24.05.26`. Invisible in review because the author's OS matches the author's expectation. |
| `new Date(backendField)` handed straight to a formatter | The zone-less SQLite shape is parsed by V8 as **local**. Executed under `TZ=America/New_York`: `"2026-08-14 12:34:56"` (really 12:34 **UTC**) becomes `16:34:56Z` — the row renders **4 hours in the future**. This is the "finished in the future" bug and `AbsoluteTime` has it at `:46`. |
| A twenty-ninth `${mins}m ago` ladder | **28 exist.** They disagree on the sub-minute rung (`just now` at 5s / 60s / 90s, `now`, `0s ago`, `—`), on whether a day rung exists at all, and on the fallback for a missing value (`-`, `''`, `Never`, `never`, `—`). Two rows on one dashboard describing the same age say different things. |
| Adding a fifteenth `*_ago` key namespace to the catalog | **48 rung strings × 13 locales = 611 translations of one vocabulary**, and they have already drifted: `plugins.fleet.ago_minutes` is `"před {n}min"` in Czech while `common.staleness_minutes_ago` is `"před {minutes}m"` — same screen, same meaning, different abbreviation. `Intl.RelativeTimeFormat` produces one consistent form for zero keys. |
| `Date.now() - then` rendered without a clamp | `PersonaHealthDashboard.tsx:74`, `StatusPageView.tsx:45` → **`-45s ago`**. Reinvented identically in both sibling repos. |
| A local `setInterval(…, 1000)` to refresh a label | **13 sites.** Each is a timer the shared ticker cannot coalesce and cannot slow as the label ages. The shared ticker exists, self-scales, and stops itself; it has 2 consumers. |
| `useState(() => formatRelative(x))` to satisfy render purity | Freezes the label forever — the opposite defect, and `personas-web` has it twice. The primitive solves purity *and* freshness with one subscription. |
| `new Date(y, m, d)` … `.toISOString().slice(0,10)` | Builds from **local** parts, reads back the **UTC** day. Executed under `Europe/Prague`: `new Date(2026, 7, 1).toISOString().slice(0,10)` → **`2026-07-31`**. `timeRange.ts:33` makes "this calendar month" start on the last day of the previous one. |
| `toLocaleDateString()` as a `groupBy` key | Locale-dependent *and* timezone-dependent bucketing: the number of groups changes with the OS locale and rows land under the wrong day header. `timeGroupKey` exists for this. |
| Hardcoding `'en-US'` | **6 sites.** Honest about being wrong, still wrong in 13 of 14 languages. `personas-web` does it 4 times out of 12. |
| A fresh `new Intl.DateTimeFormat(...)` per render | `AbsoluteTime.tsx:51` constructs one on every render of every one of its 37 call sites. `formatters.ts:91-110` shows the answer — a module-scope cache keyed by locale + options — and there is **no equivalent for dates**. |

---

## 6. Evidence

**The one site to copy: `src/features/home/sub_releases/LiveRoadmapStatusPill.tsx:22-40`.** It is the only
place in the repo that gets every clause of this path right at once, and its docblock is the argument:

- `:22-29` — names the P5 hazard by cause: *"disk-cache replay across machines, NTP corrections, DST jumps,
  or laptops just woken from sleep can produce a future timestamp. Negative `diffSec` would render as
  'in 4 minutes', which makes the freshness pill lie."*
- `:35` — `const diffSec = Math.min(0, rawDiffSec)` — the clamp, stated and implemented.
- `:38` — `new Intl.RelativeTimeFormat(language, { numeric: 'auto' })` — **the only date-locale call in
  4,829 files that receives the app's language**, and it takes it as a **required prop** (`Props.language`,
  `:48`), which is the type answer already applied once.
- `:15-19` + `:37` — a declarative `BUCKETS` table instead of an `if` ladder, so the rungs are data.

**For the elapsed primitive's shape:** `display/RelativeTime.tsx:27-38`. Normalize once at the boundary
(`:30`), parse once (`:33`), subscribe to the shared ticker (`:34`), format (`:36`), tooltip (`:38`). Copy
the *structure*; note that `:36` and `:38` resolve their locale two different ways, which is the bug.

**For the ticker:** `hooks/utility/timing/relativeTimeTicker.ts:63-84`. `reschedule()` recomputes the global
cadence, restarts only when the target actually changes, and clears the timer entirely at zero subscribers.
`cadenceForAge` (`:33-38`) is the reason this is better than any local interval: a three-day-old label costs
one wake-up per five minutes, not one per second. `brainiac/console` has no ticker and its labels are
permanently stale; `personas-web` has three, each with the page-visibility guard written separately.

**For grouping:** `display/grouping.ts:30-46`. Local calendar parts, an explicit anchor comment for the
week start, and `'older'` for unparseable input so one bad row cannot break a stream.

**For a translated ladder done as well as a catalog allows:** `plugins/drive/designTokens.ts:260-290` —
threads `t` **and** `tx` so Russian/Czech plural categories resolve, and documents that the absolute
fallback is host-locale. It is the best version of the approach this path argues against, and it is worth
reading precisely to see how much machinery `Intl.RelativeTimeFormat` replaces.

**For the anti-pattern stated as a convention:** `overview/sub_cron_agents/libs/cronHelpers.ts:8-12` —
*"Uses the same `undefined`-locale convention as the shared AbsoluteTime component."* A defect in the
primitive was read as a house style and copied. That single comment is the strongest evidence in this
document that a primitive's default is doctrine whether or not anyone intended it.

---

## 7. Deviations found

### 7.0 The finding handed to me — confirmed, and the cause is the opposite of the number case

The number-formatting composer reported that **`AbsoluteTime`, `RelativeTime` and `useFormattedDate`
implement four different locale policies**. **Confirmed by reading all three, and it is worse: there are
four policies across *three* modules, and two of the modules hold two policies each.**

| Site | Where its locale comes from | Renders |
| --- | --- | --- |
| `RelativeTime.tsx:36` (the label) | nowhere — `formatRelativeTime` is a hardcoded English ladder | `2h ago` in all 14 languages |
| `RelativeTime.tsx:38` (its own tooltip) | `new Date(…).toLocaleString()` — **host OS** | `24.05.2026, 14:03` on a German laptop |
| `AbsoluteTime.tsx:51` (the label) | `new Intl.DateTimeFormat(undefined, …)` — **host OS** | `24.05.26` on a German laptop, in the English app |
| `AbsoluteTime.tsx:55` (its own tooltip) | `formatRelativeTime` — hardcoded English | `2h ago` |
| `useFormattedDate.ts:36` | optional `locale` param, defaults to **host OS**; its one caller passes nothing | a fourth policy |
| `formatters.ts:59` (`dateFallbackDays` branch) | `.toLocaleDateString()` — **host OS** | a fifth |

A row rendering `"created 2h ago · 24.05.26"` is simultaneously English and host-German, and each half is
internally consistent, so no gate keyed on either can see it. **P7, and the sharpened version: a single
component can hold two locale policies between its label and its tooltip.**

**The deeper pattern is the same, but the cause is NOT.** The brief predicted a defaulted prop, as with
`Numeric` (`language?: string` defaulting to `'en'`, 206 of 215 call sites taking it). Measured, that is not
what happened here:

| | numbers (before the 2026-08-14 fix) | moments (today) |
| --- | --- | --- |
| Is the primitive locale-**capable**? | **yes** — `language?: string` | **no** — `RelativeTime` and `AbsoluteTime` have no locale prop at all |
| What ships? | the prop's default, `'en'` | whatever the OS is set to |
| Call-site fix available? | yes — pass `language` | **none** — there is no argument to pass |
| Adoption of the correct form | 9 of 215 | 0 of 137 (impossible) |

**So the number case was a forgotten argument; the time case is a missing one.** That distinction matters
for the fix: no amount of call-site discipline can correct `<AbsoluteTime>`, because the API does not admit
the correction. It is a strictly *stronger* argument for fixing the primitive, and a strictly *weaker* one
for a gate on the primitive's call sites — which is why §9 gates the calls that **bypass** the primitives
and deliberately declines to gate the ones that use them.

**The locale channel is confirmed present and unused for dates.** Measured independently of the number
composer: **1,497 files call `useTranslation()`; 20 destructure `language`** (the number path measured
1,505 / 20 — the small denominator difference is test-file inclusion; the numerator reproduces exactly).

### 7.A One of 84 date renders resolves the locale from the app

Every `.toLocaleDateString(` / `.toLocaleTimeString(` / `.toLocaleString(` on a Date /
`new Intl.DateTimeFormat(` / `new Intl.RelativeTimeFormat(` in `src`, first argument extracted with a
balanced-paren scan, comment-only lines dropped, tests excluded, and number-valued `.toLocaleString()`
hand-separated from date-valued:

| First argument | date sites | means |
| --- | ---: | --- |
| *(empty)* | **31** | host OS locale |
| `undefined` | **35** | host OS locale, deliberately |
| `[]` | **10** | host OS locale, spelled a third way |
| `'en-US'` | **6** | one locale, hardcoded |
| a parameter (`locale`) | 1 | capable; its only caller passes nothing |
| **the app's `language`** | **1** | `LiveRoadmapStatusPill.tsx:38` |
| **total** | **84** | |

Add the two primitives — `<RelativeTime>` 100 tags and `<AbsoluteTime>` 37 tags, neither of which *can*
receive a locale — and the app renders a moment at **221 sites**, of which **one** knows what language the
user chose.

The `'en-US'` six are worth naming because they are the honest ones:
`overview/sub_activity/libs/executionMetricsHelpers.ts:6`, `overview/sub_usage/components/DayRangePicker.tsx:46`,
`triggers/sub_triggers/triggerArmState.ts:51`, `vault/shared/playground/useApiTestRunner.ts:59`, and
`lib/types/timeRange.ts:44,63`.

### 7.B The elapsed vocabulary exists 28 times in code and 14 times in the catalog

**28 independent implementations** of "map an elapsed duration to a label", every one read:

| Category | count | sites |
| --- | ---: | --- |
| **Hardcoded English** | **12** | `lib/utils/formatters.ts:41` (**the shared one** — backs 100 `<RelativeTime>` tags + 69 direct calls) · `ConnectorDimCard.tsx:218` · `personaStats.ts:136` · `PersonaHealthDashboard.tsx:71` · `StatusPageView.tsx:42` · `CreativeSessionHistory.tsx:6` · `MediaStudioToolbar.tsx:1053` · `PeerCard.tsx:44` · `NotificationCenter.tsx:14` · `factoryData.tsx:53` · `TimelineItem.tsx:3` · `WebhookRequestInspector.tsx:36` |
| Unit-letter only (`3m` / `2h` / `4d`) | **4** | `formatRelativeShort.ts:30` · `MediaStudioPage.tsx:553` · `triageModel.ts:137` · `dimRegistry.ts:266` |
| Partly translated (label from catalog, digits bare) | **2** | `incidentTaxonomy.ts:153` · `ContactsPanel.tsx:107` |
| **Fully translated, each with its own key namespace** | **7** | `StalenessIndicator.tsx:40` · `companion/inbox/formatRelativeTime.ts:27` · `drive/designTokens.ts:266` · `fleet/relativeAgo.ts:60` · `WikiFreshnessPill.tsx:49` · `CircuitBreakerIndicator.tsx:32` · `ChannelsAtelier.tsx:126` |
| **`Intl.RelativeTimeFormat`** | **3** | `LiveRoadmapStatusPill.tsx:30` (**passes `language`**) · `cronHelpers.ts:14` (`undefined`) · `TwinPicker.tsx:66` (`undefined`) |

**So the answer to "is relative time translated?" is: yes, 12 times, in 12 different places, and the shared
primitive is not one of them.** The 100-call-site `<RelativeTime>` is English in all 14 languages; the
translated ladders are all feature-local.

**In the catalog: 48 rung strings across 14 namespaces**, all fully translated into all 13 non-English
locales (0 missing), i.e. **611 translated strings encoding one four-rung vocabulary**:

`common.staleness_*` · `shared.staleness_just_now` · `deployment.history.*` · `gitlab.*` ·
`plugins.fleet.ago_*` · `plugins.drive.time_*` · `plugins.companion.sensory_age_*` · `execution.time_*_ago` ·
`cockpit.inbox.relative_*` · `twin.wiki.freshness.*` · `twin.channels.last*Ago` · `twin.contacts.justNow` ·
`overview.incidents.just_now` · `overview.widgets.range_days_ago`

Three things make this worse than mere duplication:

- **They have already drifted per locale.** Czech: `plugins.fleet.ago_minutes` = `"před {n}min"`,
  `common.staleness_minutes_ago` = `"před {minutes}m"`. German: `"vor {n}min"` vs `"vor {minutes}m"`.
  Vietnamese: `"{n} phút trước"` vs `"{minutes}m trước"`. Two labels on one screen, one meaning, two forms.
- **Nine placeholder spellings** for the same slot — `{n}` `{count}` `{minutes}` `{mins}` `{hrs}` `{m}`
  `{h}` `{d}` `{days}` — which guarantees the namespaces can never be merged mechanically.
- **11 of the rung keys have no code consumer at all**: all 5 `gitlab.*` (the GitLab UI calls
  `formatRelativeTime` instead, at `DeploymentHistoryTab.tsx:181` and `GitOpsVersionHistory.tsx:245`), all 4
  `deployment.history.*`, `shared.staleness_just_now`, and `plugins.dev_lifecycle.triage_ago`. That is
  **143 translated strings that render nowhere**, and `check-coverage.mjs` cannot see it because they are
  present in every locale.

`en.json` has **no `common.time` section**. There is no home for this vocabulary, which is why fourteen were
built.

### 7.C The instant itself is wrong in the fixed-moment primitive — measured, not reasoned

`AbsoluteTime.tsx:46` is `Date.parse(timestamp)` with no `normalizeTimestamp`. Executed under
`TZ=America/New_York` against the shape SQLite's `datetime('now')` writes:

```
input                   "2026-08-14 12:34:56"   (UTC, zone-less — 337 DDL defaults produce this)
new Date(input)      -> 2026-08-14T16:34:56Z    (V8's non-standard fallback reads it as LOCAL)
truth                -> 2026-08-14T12:34:56Z
skew                 -> +4 hours
AbsoluteTime renders -> "Aug 14, 2026, 12:34 PM"
correct              -> "Aug 14, 2026,  8:34 AM"
```

For every viewer **west of UTC** the row renders a moment that has not happened yet — an execution that
finished in the future. For every viewer **east of UTC** it renders one that is stale by the offset. Only a
UTC viewer sees the truth, and CI is a UTC viewer.

This is [`timestamp-storage.md`](./timestamp-storage.md)'s P0 and it is still open at `58d82e608`. It is
restated here because it is the *display* consequence and because **37 call sites in 31 files trust a
docblock (`AbsoluteTime.tsx:30-36`) that tells them this primitive is the canonical answer.** The fix is one
line: wrap `:46` in `normalizeTimestamp`.

Two further instant-level defects belong to display:

- **`lib/types/timeRange.ts:33`** — `const toISO = (d) => d.toISOString().slice(0, 10)` applied to dates
  built from **local** parts at `:38` and `:43`. Executed under `Europe/Prague`:
  `new Date(2026, 7, 1).toISOString().slice(0,10)` → **`2026-07-31`**. "Calendar month: August" starts on
  31 July. The same construction at `OverviewFilterContext.tsx:38` sets a filter's end date to *tomorrow*
  for any user west of UTC after their local 19:00. `personas-web` reinvented this exact shape at
  `usageViewData.ts:15-23`.
- **`KnowledgeAtelier.tsx:41`** — `const key = d.toLocaleDateString()` used as a **grouping key**, so the
  bucket boundaries follow the host OS's locale *and* timezone. `timeGroupKey` exists precisely for this.

**33 sites** use `.slice(0,10)` / `.split('T')[0]` on a timestamp; **12** of them slice a value produced by
`.toISOString()`. Each one is a UTC calendar day presented as the reader's calendar day.

### 7.D The shared ticker has two consumers; thirteen sites hand-roll a one-second timer

`relativeTimeTicker.ts` is a well-built answer to P3 — one timer, age-scaled cadence, self-stopping — and it
is imported by exactly **two** files: `RelativeTime.tsx:3` and `vault/shared/hooks/useRotationTicker.ts:1`.

Meanwhile **39 of the repo's 82 `setInterval` sites** sit next to a timestamp computation, and **13 fire at
1s or faster**: `CompilationStepper.tsx:43`, `HealingCard.tsx:25`, `PersonaMonitor.tsx:113`,
`AiHealingStreamOverlay.tsx:25`, `FleetActivityStrip.tsx:128`, `ConnectionStatusBadge.tsx:70`,
`PersonaListPopover.tsx:43`, `N8nParserResults.tsx:54`, `N8nStepIndicator.tsx:47`, `LiveStreamTab.tsx:165`,
`autoCredHelpers.ts:97`, `AnalyzingPhase.tsx:39`, plus `athenaChatVoice.ts:96` at 1ms.

**Credit where due: most are bounded, and deliberately so.** `FleetActivityStrip.tsx:126` gates on
`hovered && running > 0` with a comment saying why; `PersonaMonitor.tsx:112` gates on
`anyRunning && viewMode !== 'channels'` with a comment explaining that the channel view consumes no
elapsed values; `ConnectionStatusBadge` runs only while reconnecting. **The defect is not unboundedness —
it is fragmentation.** Thirteen timers on independent phases, none coalesced, none age-scaled, and
`plugins/fleet/relativeAgo.ts:10-31` is a **second shared ticker** built from scratch at a fixed 30s with
its own subscriber set — its comment (`:5-9`) states the exact rationale of the ticker that already exists.
`PersonaListPopover.tsx:43` is the one unconditional 1s interval, bounded only by the popover's mount.

### 7.E Future timestamps: eight of twenty-eight ladders clamp, two render a negative

| Behaviour | count | examples |
| --- | ---: | --- |
| Clamps, with the reasoning stated | 1 | `LiveRoadmapStatusPill.tsx:28,35` |
| Clamps silently (`Math.max(0, …)`) | 7 | `factoryData.tsx:57` · `MediaStudioPage.tsx:554` · `ContactsPanel.tsx:109` · `WikiFreshnessPill.tsx:42` · others |
| Falls through to "just now" because the first rung's bound is satisfied by any negative | ~16 | `formatters.ts:51` (`diffSeconds < 5`) and most of the ladder family |
| **Renders a negative label** | **2** | `PersonaHealthDashboard.tsx:74` · `StatusPageView.tsx:45` → **`-45s ago`** |
| Returns `''` for a future stamp | 1 | `TwinPicker.tsx:66` |
| Renders forward time (`in 5 minutes`) | 0 | — |

The dominant behaviour — silently becoming "just now" — is the one that **masks** §7.C: a UTC-misparsed
timestamp on a west-of-UTC machine is hours in the future, and 16 ladders render that as *just now* rather
than as anything a user or a developer could notice. **Nothing in this repo reports skew.** `personas-web`
does (`format.ts:43-57`, a once-per-session Sentry breadcrumb past a 60s tolerance) and this repo should
copy it.

### 7.F Style fragmentation: four presets, thirty-one option bags

`AbsoluteTime`'s `FORMATS` map (`:10-16`) defines the four agreed shapes. Against that, **42 raw calls in 32
files pass their own `Intl.DateTimeFormatOptions` bag**, and they disagree on everything that can be
disagreed on: `{ month: 'short', day: 'numeric' }` (9×), `{ weekday: 'short', month: 'short', day: 'numeric' }`
(3×), `{ hour: '2-digit', minute: '2-digit' }` (6×), `{ hour: 'numeric', minute: '2-digit' }`,
`{ hour12: false, … second: '2-digit' }` (2×), `{ month: 'short', year: 'numeric' }`, `{ dateStyle, timeStyle }`.

**Exactly three sites in the whole app pass a `timeZone:` option**, and each is instructive:
`LimitsSettings.tsx:77` pins `'UTC'` deliberately for a month-key label (and still leaves the *locale* to
the OS); `FrequencyEditor.tsx:213` threads a user-chosen preview zone, which is the only genuine multi-zone
requirement in the repo; `triggerArmState.ts:52` uses one to read wall-clock parts in a trigger's configured
zone. **Every other render in the app — 218 of the 221 — silently takes the host's zone**, which is
*correct* provided the instant handed in was unambiguous. That is exactly why §7.C is a wrong-**instant**
bug rather than a display one: the zone is right and the point it is applied to is not.

### 7.G Performance: one `Intl` cache exists and it is the wrong one

`formatters.ts:91-110` documents why `Intl` construction must be cached — *"one of the most expensive
stdlib constructors (locale data resolution, options validation)"* — and caches `Intl.NumberFormat` keyed by
locale + varied options. **There is no `Intl.DateTimeFormat` cache anywhere.** `AbsoluteTime.tsx:51`
constructs a fresh one **outside** the component's `useMemo` (which covers only the `ms` parse at `:44-47`),
so every render of every one of its 37 call sites pays full construction — and the sites are exactly the
dense ones: 6 table/list surfaces and 3 detail drawers. `LiveRoadmapStatusPill.tsx:38` constructs a
`RelativeTimeFormat` per call for the same reason.

### 7.H Nothing tests any of it

- `src/lib/utils/__tests__/formatters.test.ts` — **23 assertions, all numeric**. `formatRelativeTime`,
  `normalizeTimestamp`, `formatTimestamp`, `timeAgo` and `formatSignedOffset` have **no `describe` block**.
- There is **no `AbsoluteTime.test.tsx` and no `RelativeTime.test.tsx`.** The two primitives this leaf is
  about are untested.
- `vitest.config.ts` sets **no `TZ`**, so every suite runs in the runner's local zone. In CI that is UTC —
  the one zone in which §7.C's bug is invisible. `display/__tests__/grouping.test.ts:35` asserts
  `timeGroupKey('2026-05-28T01:00:00', NOW) === 'today'` on an **unzoned** fixture, which passes only
  because both sides are read locally: the test enshrines the misparse as correct.
- Three test files do exercise time display, and all three belong to *feature-local* ladders:
  `companion/inbox/formatRelativeTime.test.ts`, `drive/__tests__/designTokens.test.ts`,
  `relativeTimeTicker.test.ts`. The shared path has none.

---

## 8. Gaps in the primitives

1. **`RelativeTime` and `AbsoluteTime` cannot be told what language the app is in.** Not "forget to" —
   *cannot*: neither has a locale prop, and neither reads the store. This is upstream of §7.A, §7.B and the
   `cronHelpers.ts:11` comment that promoted the defect to a convention. **Fix:** export `activeLanguage()`
   from `formatters.ts:21` (it exists, it is module-private, and the number-formatting fix already made
   `formatters.ts` import `useI18nStore` — so the shared-components boundary is already crossed
   transitively) and read it in both primitives, with an optional prop as the override. See the
   type-over-gate answer.
2. **The elapsed vocabulary has no home, so it grew fourteen.** `en.json` has no `common.time` section.
   **Fix, and it is the cheaper one: do not give it a home — give it to the platform.** Replace
   `formatRelativeTime`'s ladder body with `Intl.RelativeTimeFormat(activeLanguage(), { numeric: 'auto' })`.
   That retires 47 catalog keys × 14 locales, gets plural categories and word order right in languages this
   team does not speak, and makes 12 feature-local ladders deletable rather than translatable. The one thing
   it does not give you is the abbreviated form (`2h` vs `2 hours`) — `style: 'narrow'` is the closest, and
   `cronHelpers.ts:12` already uses it.
3. **There is no `Intl.DateTimeFormat` cache** (§7.G), and the module that proves the pattern is three
   functions away. **Fix:** a `getDateTimeFormat(locale, options)` beside `getNumberFormat`.
4. **No skew policy and no skew telemetry.** Sixteen ladders render a future instant as "just now", which is
   the behaviour most likely to hide §7.C from everyone. **Fix:** adopt `personas-web`'s
   `FUTURE_SKEW_TOLERANCE_MS` shape — clamp inside tolerance, abandon relative rendering outside it, and
   emit one `silentCatch`-style breadcrumb per session.
5. **`useFormattedDate` is a fourth locale policy with one caller.** It exists for a real reason (memoizing
   `toLocaleString` on list rows, per a 2026-05-17 perf scan) that `AbsoluteTime` + a format cache would
   serve better. **Fix:** migrate `PersonaOverviewColumns.tsx:40` to `<AbsoluteTime>` and delete the hook.
6. **`AbsoluteTime`'s four variants do not cover the shapes the app actually wants.** 42 call sites in 32 files pass
   their own options bag, and the three commonest —`{month:'short',day:'numeric'}`,
   `{hour:'2-digit',minute:'2-digit'}`, `{weekday:'short',month:'short',day:'numeric'}` — have no variant.
   Gating §7.F before adding them would ratchet toward a destination that does not exist. **Fix:** add
   `dayMonth`, `clock` and `weekdayDate` variants first.
7. **Nothing types a timestamp.** Every backend moment arrives as `string` through the ts-rs bindings,
   indistinguishable from any other string, so `new Date(row.created_at)` type-checks perfectly. This is
   [`timestamp-storage.md`](./timestamp-storage.md) Gap 5 and it is the reason §9 has to key on the
   *formatting call* rather than on the *value*.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what follows is a
*proxy* for a semantic condition tuned to this repo's idiom. The conditions are stated first so an adopting
repo re-derives its own. The portability risk is measured and concrete: `brainiac/console` has the
locale-blindness condition at full scale with **no i18n system at all**, so C1's proxy would fire there
while pointing at a fix that cannot be written; and `personas-web` spells 4 of its 12 locale-blind date calls
as `'en-US'`, which the proxy below deliberately does **not** match.

Everything in §7 shipped under a green `npm run check`, a green `npm run test`, a green
`npm run check:i18n:strict` (the 143 dead translated strings are present in every locale, so coverage is
perfect) and a green `npm run census`.

### Semantic conditions, stated stack-free

- **C1 — a moment is rendered through a locale-resolution path that resolves to the machine the code is
  running on rather than to the language the user chose in the application.** *Proxy here:* a date/time
  formatting call whose locale argument is absent, `undefined`, or an empty list. *Precondition:* this repo
  ships an app-level language, exposes it through one hook, and spells a date render as a `toLocale*String`
  method call or an `Intl` constructor.
- **C2 — the closed, universal vocabulary of elapsed time is authored at a call site in one natural
  language, so it can be neither translated nor made consistent with the other places that authored it.**
  *Proxy here:* a string interpolation closed by an English elapsed suffix, or a bare `return 'just now'`.
  *Precondition:* this repo writes elapsed labels as template literals ending in `ago` and its lowest rung
  as the literal `just now`.

### Conditions deliberately NOT given a census rule

- **C3 — a moment rendered through a shared primitive that is itself locale-blind (137 sites).** This is the
  largest population in the document and it must **not** be gated. There is no legal fix at the call site —
  the primitives take no locale (§7.0) — so a ratchet here would count violations that no author can
  resolve. **The fix is two lines, one per primitive.** Gate this only if the primitive change is rejected,
  and then gate the primitive, not its callers. Same sequencing as
  [`number-and-cost-formatting.md` C3](./number-and-cost-formatting.md#9-the-missing-gate).
- **C4 — a hardcoded `'en-US'` locale (6 sites).** Real, but six sites do not need a ratchet and the shape
  is a *different* proxy that would halve C1's precision by admitting every legitimately-pinned locale (a
  fixed-locale export preview is a real requirement). Fix them in the C1 sweep.
- **C5 — a bespoke `Intl.DateTimeFormatOptions` bag instead of a variant (42 sites / 32 files).** Blocked on Gap 6:
  three of the commonest shapes have no variant to migrate to. Publish the variants, then gate. Ratcheting
  toward a destination that does not exist is how a gate teaches people to add exemptions.
- **C6 — a hand-rolled `setInterval` refreshing a time label (13 sites).** Not regex-shaped: the same
  `setInterval(fn, 1000)` is a violation next to an elapsed label and correct next to a progress bar, and
  distinguishing them requires knowing what the callback closes over. Most are already correctly bounded
  (§7.D) — the defect is fragmentation, which is a refactor, not a ratchet.
- **C7 — a local-parts date serialized as UTC (`timeRange.ts:33`, `OverviewFilterContext.tsx:38`).** Two
  sites. A rule that matched `.toISOString().slice(0,10)` would catch 12, of which 10 are legitimately
  UTC-derived. Precision would be 17%. Fix the two by hand; they are named in §7.C.
- **C8 — a `useMemo` building a formatted date without `language` in its deps.** Vacuous today (no date
  render reads `language`) and structurally identical to that path's C8. It becomes live the day Gap 1 lands.

### The rules — validated

Both were run against the working tree with
`node scripts/census/run-census.mjs --rules <scratch-file> --check` → **exit 0** at the baselines below.
**`host-locale-date-render`'s count of 55 was reproduced exactly by an independent second implementation** —
a separate balanced-paren argument extractor with its own comment filter, written before the regex and not
importing `lib/engine.mjs`: it classified 62 date-locale calls of these four kinds, minus 6 hardcoded and 1
app-language, leaving 55. Every match of both rules was then read individually: **55/55** and **47/47** are
genuine instances of the stated condition.

```json
{
  "rules": [
    {
      "id": "host-locale-date-render",
      "goldenPath": "docs/concepts/golden-paths/timestamp-display.md",
      "title": "A moment rendered through a locale-resolution path that cannot see the app's language",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\.toLocale(?:Date|Time)String\\s*\\(\\s*(?:\\)|undefined\\b|\\[\\s*\\])|new\\s+Intl\\.(?:DateTimeFormat|RelativeTimeFormat)\\s*\\(\\s*(?:\\)|undefined\\b|\\[\\s*\\])|new\\s+Date\\s*\\([^()]*\\)\\s*\\.toLocaleString\\s*\\(\\s*\\)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a date/time formatting call whose locale argument is absent, `undefined`, or `[]` — three spellings of \"use whatever locale the operating system is set to\". PROXY FOR the stack-free condition: a moment is projected into a calendar and a clock using the locale of the machine the code runs on rather than the language the user chose in the application, so a user who set this app to Japanese on an en-US laptop reads `5/24/26` and a user who set it to English on a German laptop reads `24.05.26`. Verified against the app's own machinery: useTranslation() (src/i18n/useTranslation.ts:325) returns `{ t, tx, language }` over 14 shipped locales and i18nStore.ts:94 even mirrors the chosen language into the Rust backend — so the correct value is available at every one of these call sites and reaches exactly ONE of them (LiveRoadmapStatusPill.tsx:38). Measured population: a balanced-paren census of every toLocale*String / Intl.DateTimeFormat / Intl.RelativeTimeFormat first argument in all 4,829 src .ts+.tsx found 84 date-locale decisions — 76 host-OS, 6 hardcoded 'en-US', 1 parameterised-but-never-passed, 1 correct. This pattern covers 55 of the 76: `.toLocaleString(` is deliberately EXCLUDED because it is ambiguous between a Date and a number and would collide with number-and-cost-formatting.md's territory, which costs ~20 date sites of recall and buys 100% precision. Precision 55/55 on a full read of every match: every one is a date or time formatted for a locale the app did not choose. Two matches are non-product destinations (LabVersionsTable.tsx:298,312 stamp an exported comparison report; run-harness.ts:56 prints a harness console line) and are carried in the baseline rather than excluded, because a directory-level exemption for two lines adds a stale-exclude failure mode worth more than it saves. PRECONDITION (measured, must be re-derived per repo): this repo owns an app-level language, exposes it through one hook, and spells a date render as a toLocale*String method or an Intl constructor. A repo with no i18n system has the condition and no fix — brainiac/console has 3 such calls, zero locale channel, and nothing to wire; a repo that pins a literal locale instead scores zero here while being equally locale-blind — personas-web spells 4 of its 12 date-locale calls as 'en-US' and this pattern declines all four. LEGAL FIX: <RelativeTime timestamp={x}/> for elapsed, <AbsoluteTime timestamp={x} variant=\"datetime|date|time|compact\"/> for a fixed moment, or — for a raw Intl call that must stay raw — the `language` from useTranslation(), as LiveRoadmapStatusPill.tsx:38 does. NOTE THE DESTINATION IS NOT YET CORRECT BY DEFAULT: both primitives resolve their own locale from the host OS today (AbsoluteTime.tsx:51, RelativeTime.tsx:38), so routing a call site there buys correctness of instant, cadence and style and defers the language until §8 Gap 1 lands. Sequence Gap 1 before burning this baseline."
      },
      "baseline": { "files": 43, "matches": 55 },
      "floor": 4000
    },
    {
      "id": "english-elapsed-label",
      "goldenPath": "docs/concepts/golden-paths/timestamp-display.md",
      "title": "An elapsed-since-a-moment label assembled from an English word at the call site",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\$\\{[^{}]*\\}\\s*(?:s|m|h|d|sec|secs|min|mins|hr|hrs|seconds?|minutes?|hours?|days?)?\\s+ago\\b|\\breturn\\s+(['\"])just now\\1",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a string interpolation closed by an English elapsed suffix and the word `ago`, or a bare `return 'just now'`. PROXY FOR the stack-free condition: the closed, universal vocabulary of elapsed time — a set every locale already has a canonical form for, including its plural rules and word order — is authored per call site in one natural language, so it can be neither translated nor made consistent with the other places that authored it. The interpolation anchor is load-bearing: it restricts matches to a LADDER RUNG (a computed count plus a unit) rather than to prose containing the word `ago`; dropping it to a bare \\bago\\b admits 11 more files of comments and sentences (measured). Measured population: 28 independent elapsed ladders exist in this repo, every one located and read — 12 hardcoded English (including lib/utils/formatters.ts:41, the SHARED one behind 100 <RelativeTime> tags and 69 direct calls), 4 unit-letter-only, 2 partly translated, 7 fully translated each with its OWN key namespace, and 3 using Intl.RelativeTimeFormat of which one passes the app language. The catalog side is the receipt: 48 rung strings across 14 namespaces, fully translated into all 13 non-English locales (611 strings for one four-rung vocabulary), spelled with 9 different placeholder names, ALREADY DRIFTED per locale (Czech `před {n}min` in plugins.fleet vs `před {minutes}m` in common.staleness), and 11 of the keys have no code consumer at all — 143 translated strings that render nowhere, invisible to check-coverage.mjs because they are present in every locale. Precision 47/47 on a full read: all 47 are English elapsed phrases. 45 of the 47 are ladder rungs whose fix is this path's; 2 (provenance.ts:78, populateDispatch.ts:124) are English sentences that happen to contain an elapsed phrase, whose fix is i18n-string-authoring.md's — recorded rather than excluded because both readings agree the string is wrong. Deliberately NOT matched: the English fallbacks behind a translated lookup (`t?.x ?? 'just now'`), because those render only when a key is missing. PRECONDITION (measured, must be re-derived per repo): this repo writes an elapsed label as a template literal ending in `ago` and its lowest rung as the literal `just now`. A repo whose ladder returns `il y a {n} min`, or spells the rung `Ns`/`Nm` with no word at all (this repo already has 4 such, and brainiac/console has 2 of 7), scores zero while the condition is present — which is why this rule is the SECOND of the two and not the first. LEGAL FIX, in order: (1) replace lib/utils/formatters.ts:41's ladder body with `new Intl.RelativeTimeFormat(activeLanguage(), { numeric: 'auto', style: 'narrow' })`, which retires 47 catalog keys across 14 locales and gets plural categories and word order right in languages nobody here speaks — LiveRoadmapStatusPill.tsx:30 is the working precedent and it also clamps the future, which 2 of these ladders fail to do (`-45s ago` at PersonaHealthDashboard.tsx:74 and StatusPageView.tsx:45); (2) then delete each local ladder in favour of <RelativeTime> or formatRelativeTime. Doing (2) first consolidates 28 English ladders into 1 English ladder, which is progress but not a fix."
      },
      "baseline": { "files": 16, "matches": 47 },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   host-locale-date-render     43     43       55     55    4829   4000
  OK   english-elapsed-label       16     16       47     47    4829   4000
  census OK — 2 rule(s), 9658 file-visits, 102 surviving violation(s) across 59 file(s).
```

Floors sit below the observed walk (4,829 `.ts`+`.tsx` under `src`, reproducing `shared-facts.json`) with
margin, consistent with `raw-select`, `raw-web-storage` and `hand-assembled-currency` on the same tree.
Neither rule needs an `exclude`, which removes the stale-exemption failure mode entirely — the two
non-product matches are carried in the baseline and named in the description instead.

**On the two tooling traps.** Both patterns were authored **in a file**, never in shell argv — the first
attempt at a throwaway measurement through `node -e` on Git Bash produced
`Invalid regular expression: /formatRelativeTimes*(/g` because MSYS ate the backslashes, which is the same
mangling that cost an earlier composer 5 counts. And neither pattern uses a lookbehind: both discriminate by
**forward anchors** (`\$\{[^{}]*\}` before the suffix; the `\(\s*` prefix before the locale argument), so
V8 has no variable-length assertion to re-evaluate per index. Both rules complete inside the runner's normal
walk with no measurable cost.

### How each fails loudly if its own precondition is absent

Not asserted — **executed**. Every failure mode was induced against the real working tree and the exit code
captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits, 102 surviving violation(s) across 59 file(s).` |
| R1 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| R1 `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| R1 baseline inflated (a silent drop) | **1** | `[drift] files dropped 300 -> 43 (-257) without the baseline moving.` |
| R1 baseline deflated (a rise) | **1** | `[drift] files rose 20 -> 43 (+23). New violations of …timestamp-display.md` |
| R1 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| R1 `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| R1 `exclude` pointing at a moved path | **1** | `[structural] exclude "src/does/not/exist/**" matched no file. The exemption is stale` |
| R1 `exclude` `reason` shortened | **1** | `exclude[0] … needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **R1 POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files rose 43 -> 116 (+73)` — see below |
| R2 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere.` |
| R2 `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000.` |
| R2 baseline inflated (a silent drop) | **1** | `[drift] matches dropped 400 -> 47 (-353) without the baseline moving.` |
| R2 baseline deflated (a rise) | **1** | `[drift] matches rose 30 -> 47 (+17).` |
| R2 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| **R2 POSITIVE CONTROL — pattern → the COMPLIANT form** | **1** | `[drift] files rose 16 -> 139 (+123)` — see below |
| R2 interpolation anchor removed (bare `\bago\b`) | **1** | `[drift] files rose 16 -> 27 (+11)` — the anchor is load-bearing, not decorative |

**The positive control — proving the matcher discriminates rather than merely matches.** Every fault above
only proves a rule can *break*. So each pattern was **inverted to the compliant spelling** and re-run against
the same baseline. Both fail, and the file sets are near-disjoint:

| | violating pattern | compliant pattern | files matching **both** |
| --- | --- | --- | ---: |
| R1 | host-OS locale argument → **43 files / 55 matches** | `<AbsoluteTime` / `<RelativeTime` / an `Intl` call taking `language` → **116 files / 138 matches** | **3** |
| R2 | English `${n}m ago` rung → **16 files / 47 matches** | `<RelativeTime` / `formatRelativeTime(` → **139 files / 194 matches** | **2** |

The compliant form is in both cases **more common** than the violating one and almost never in the same
file, which is the strongest available demonstration: both spellings are abundant in this codebase and the
matcher separates them cleanly. Under the census the substitution produces `[drift] files rose 43 -> 116`
and `16 -> 139` — **exit 1**, so neither gate can be satisfied by pointing it at the right answer. The five
overlap files are genuine: `CockpitPanel.tsx`, `AnomalyDrilldownPanel.tsx` and `WebhookRequestInspector.tsx`
each contain one correct render and one raw one; `formatters.ts` and `companion/inbox/formatRelativeTime.ts`
each contain both the ladder and its own export/fallback.

### The gate that points at a broken destination — named, per the contract's fifth failure mode

`host-locale-date-render`'s mechanism is *"use the shared primitive"*, and
[`golden-path-contract.md:84-107`](../golden-path-contract.md) requires stating what makes the primitive
correct by default. **It does not, yet.** `<AbsoluteTime>` resolves its label's locale from the host OS
(`:51`) and its tooltip's language from a hardcoded English ladder (`:55`); `<RelativeTime>` does the
reverse. So this rule, satisfied fully, would move 55 call sites from *host-OS locale* to *host-OS locale
inside a primitive* — a real improvement in instant-correctness, cadence and style consistency, and **no
improvement in language at all**. That is exactly the shape that made `custom/prefer-numeric` report green
over a 96%-broken app.

Hence the sequencing below is not advisory. **Gap 1 lands first, or this gate manufactures confidence.**

### Sequencing

1. **Wrap `AbsoluteTime.tsx:46` in `normalizeTimestamp` (§7.C).** One line. It is a wrong-instant bug on 37
   call sites for every user not in UTC, and it is the only item here that is a false statement rather than a
   style defect.
2. **Export `activeLanguage()` and read it in both primitives (Gap 1).** Two lines each. This is what makes
   the destination worth arriving at, and it closes 137 sites without touching one of them.
3. **Add a `getDateTimeFormat` cache beside `getNumberFormat` (Gap 3)** while `AbsoluteTime` is open.
4. **`host-locale-date-render` immediately after 1–3.** 55 sites, one legal fix, a destination that is now
   correct by default.
5. **Replace `formatRelativeTime`'s ladder with `Intl.RelativeTimeFormat` + clamp (Gaps 2 and 4).** This is
   the single edit that translates the elapsed vocabulary into 14 languages, retires 47 catalog keys, and
   fixes `-45s ago` — and it makes the destination for step 6 correct.
6. **`english-elapsed-label` after step 5.** 47 sites, 28 ladders, one legal fix.
7. **Delete the 11 orphaned rung keys and their 143 translations (§7.B)** in the same pass, before anyone
   translates them again.
8. **Publish the three missing `AbsoluteTime` variants (Gap 6), then consider C5.**
9. **Add the date half of `formatters.test.ts` with a non-UTC `TZ` guard (§7.H)**, mirroring
   [`timestamp-storage.md` §9.3](./timestamp-storage.md)'s prescription — the same guard, for the same
   reason, on the display side.

---

## Type over gate — the answer

**Yes — and this leaf is a stronger case for it than the number leaf was, because here the call site has no
way to be right.**

**1. The largest deviation class is not a habit and not even a default — it is a missing parameter.**
`Numeric` had `language?: string = 'en'`, so 206 authors *could* have passed it and did not; that is a
default problem, and the contract's *"prefer fixing the default over counting the callers"* applies
directly. `RelativeTime` and `AbsoluteTime` have **no locale parameter at all**. There is nothing to forget
and nothing to remember. 137 call sites are locale-blind because the API is, and **no gate on those call
sites could ever be satisfied**. A rule pointed at them would be a rule that can only be silenced.

**2. The fix has already been performed once in this repo, two days ago, on the sibling leaf.**
`formatters.ts:21` now holds

```ts
const activeLanguage = (): string => useI18nStore.getState().language;
```

with a docblock stating the measured reason (~96% non-compliance on the prop). Three consequences follow,
and together they collapse the objection that blocked the number fix for months:

- **The boundary argument is spent.** `Numeric`'s fix was blocked by
  [`CLAUDE.md`](../../../.claude/CLAUDE.md)'s rule that `shared/components/**` should not import `@/stores`.
  That import now exists in `formatters.ts`, which `RelativeTime.tsx:2` already imports. The boundary is
  crossed transitively today; the only question left is whether it is crossed *knowingly*.
- **The change is additive.** Export `activeLanguage`, then:

  ```ts
  // AbsoluteTime.tsx:51
  const label = getDateTimeFormat(language ?? activeLanguage(), FORMATS[variant]).format(ms);
  // RelativeTime.tsx:36 — via formatRelativeTime
  return rtf(language ?? activeLanguage()).format(-diffMinutes, 'minute');
  ```

  with `language?: string` surviving as a genuine override for a fixed-locale export preview — the same
  shape `Numeric` ended up with, and the same shape `LiveRoadmapStatusPill.tsx:48` already proves by taking
  `language` as a **required prop**.
- **It corrects 137 call sites with four lines**, and no ratchet would have moved a single one.

**3. A second type change closes the vocabulary class, and it is not a type in this codebase — it is a type
in the platform.** `Intl.RelativeTimeFormat`'s signature is `format(value: number, unit: RelativeTimeUnit)`.
It **cannot** be called without a locale and it **cannot** emit a language of your choosing: the unit words,
the plural category and the word order are properties of the locale argument, not of the call site. That is
the constraint made unrepresentable. Fourteen catalog namespaces and 611 translated strings exist because
this repo re-implemented, in TypeScript and JSON, a function whose signature already refuses the mistake.
`LiveRoadmapStatusPill.tsx:30` is the proof it fits: 10 lines, 4 declarative buckets, zero keys, 14
languages, and a clamp.

**4. A third, cheaper type change closes the style class.** `AbsoluteTime`'s `variant` prop is already a
closed union (`'datetime' | 'date' | 'time' | 'compact'`) and it is *why* those four shapes are consistent.
The 42 sites that pass a raw `Intl.DateTimeFormatOptions` bag do so because the union is missing three
members (Gap 6). **Widen the union, do not widen the API.** The moment `AbsoluteTime` accepts an arbitrary
options object, the vocabulary becomes open and the fifth shape is one prop away — the exact failure
[`design-token-usage.md`](./design-token-usage.md) found when a token vocabulary was left as open strings.

**5. Where no type can reach, and it is the same wall the number leaf hit.**
`` `${mins}m ago` `` and `new Date(x).toLocaleDateString()` both produce `string`. The type system cannot
distinguish a moment that has been rendered from a moment that has been mangled, because both are `string` —
and it cannot distinguish a correctly-parsed instant from a four-hour-skewed one, because both are `number`.
The structural answer would be a branded `Timestamp` newtype emitted by ts-rs
([`timestamp-storage.md`](./timestamp-storage.md) Gap 5) so that `new Date(row.created_at)` fails to
compile — larger than this path, correct in the long run, and the reason §9 exists in the meantime.

**6. The general rule, and it is a fourth variation on the same theme.**
[`design-token-usage.md`](./design-token-usage.md) found an open vocabulary and closed it.
[`i18n-string-authoring.md`](./i18n-string-authoring.md) found a closed one and made every authoring site
accept a key. [`number-and-cost-formatting.md`](./number-and-cost-formatting.md) found a format that could
not be enumerated and made the primitive supply its own locale. Here:

> **Do not translate what the platform already knows, and do not let a primitive inherit its locale from
> the machine.** Every deviation in this document is a place where the ambient default — the OS's locale,
> the author's language, the local clock — was one keystroke closer than the app's own answer. The
> primitive that reads the app's language itself, clamps its own future, and takes its unit words from
> `Intl` has no ambient default left to inherit.
