---
layer: application
subject: status-vocabulary
technique: timestamp-display
stack: react
---

# React application — timestamp display

This repo built both pieces of infrastructure the technique mandates —
the display primitives and the shared self-scaling ticker — and neither
sibling repo has either (`personas-web` runs three independent timers;
`brainiac/console` has none, so its relative labels go permanently
stale). It is also the cleanest specimen of the technique's sharpest
finding: the primitives are ahead *and locale-blind*, and the blindness
is a **missing argument, not a forgotten one**. Deep audit:
`docs/concepts/golden-paths/timestamp-display.md` (2026-08-14, recurrence
141, against `58d82e608`).

## The primitives and the ticker

- `src/features/shared/components/display/RelativeTime.tsx` — 100 tags /
  86 files. Normalizes the backend's zone-less string at the boundary
  (`:30`, the only display primitive that does), subscribes to the shared
  ticker (`:34`), memoized, absolute value in the tooltip.
- `display/AbsoluteTime.tsx` — 37 tags / 31 files, four named variants in
  its `FORMATS` map (`:10-16`) so dense tables and drawers agree.
- `src/hooks/utility/timing/relativeTimeTicker.ts` — one timer for the
  whole app: `cadenceForAge` scales 1s → 30s → 5m as labels age
  (`:33-38`), restarts only when the target cadence changes, stops at
  zero subscribers. Consumers: **2 files** — while 13 sites hand-roll a
  ≤1s interval and `plugins/fleet/relativeAgo.ts:10-31` is a *second*
  shared ticker whose comment restates the first one's rationale.

## Four locale policies in three modules

Measured (§7.0 of the audit): `RelativeTime`'s label is hardcoded English
(`formatRelativeTime`'s ladder), its own tooltip is host-OS
(`:38` `toLocaleString()`); `AbsoluteTime`'s label is host-OS
(`new Intl.DateTimeFormat(undefined, …)`, `:51`, unmemoized per render),
its tooltip is English. One row — "created 2h ago · 24.05.26" — is
simultaneously English and host-German, each half internally consistent,
so no gate keyed on either can see it. Of **221** moment renders
app-wide, **one** receives the app's language
(`LiveRoadmapStatusPill.tsx:38`). Neither primitive *can* be corrected at
the call site: no locale prop exists — the missing-argument case, fix at
the primitive (export `activeLanguage()` from `formatters.ts:21`, read it
in both). The doctrine effect is on record verbatim:
`overview/sub_cron_agents/libs/cronHelpers.ts:8-12` — *"Uses the same
`undefined`-locale convention as the shared AbsoluteTime component"* — a
primitive's defect copied as house style.

## The elapsed vocabulary, forked 28 + 14 times

28 hand-rolled elapsed ladders (12 hardcoded English including the
shared `formatRelativeTime` behind all 100 `<RelativeTime>` tags; 7
fully translated, *each with its own key namespace*; 3 using
`Intl.RelativeTimeFormat`). The catalog holds **48 rung strings across
14 namespaces = 611 translations of one four-rung vocabulary**, already
drifted per locale (Czech: `"před {n}min"` vs `"před {minutes}m"` on one
screen) with nine placeholder spellings and 143 dead strings no code
consumes — invisible to `check-coverage.mjs` because they are present in
every locale. The platform answer is used 3 times here, 0 in either
sibling; the one complete site is the one to copy.

## The clamp, and the copy-worthy exemplar

`src/features/home/sub_releases/LiveRoadmapStatusPill.tsx:22-40` is the
only site that gets every clause right at once: a docblock naming the
skew causes (NTP, DST, sleep-wake), `Math.min(0, diff)` (`:35`), a
declarative `BUCKETS` table, and `Intl.RelativeTimeFormat(language)`
with `language` as a **required prop** — the type answer applied once.
Against it: two sites render `-45s ago`
(`PersonaHealthDashboard.tsx:74`, `StatusPageView.tsx:45` — the same
negative render both siblings independently reinvented), and ~16 ladders
let any negative satisfy the first rung and render a future instant as
*just now* — masking the wrong-instant bug (`AbsoluteTime.tsx:46` parses
without `normalizeTimestamp`, so zone-less rows render hours in the
future west of UTC; CI, being UTC, cannot see it). No skew telemetry
exists here; `personas-web`'s `format.ts:28-64`
(`FUTURE_SKEW_TOLERANCE_MS`, abandon-relative + one Sentry breadcrumb
per session) is the shape to adopt.
