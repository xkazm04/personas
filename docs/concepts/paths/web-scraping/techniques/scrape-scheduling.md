---
layer: technique
subject: web-scraping
technique: scrape-scheduling
status: forged
laws: [failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Scrape scheduling

Scraping earns its infrastructure through repetition, and repetition runs on
a schedule. The general machinery — next-run computation, catch-up and
missed-run semantics, overlap guards, run observability — is the
[scheduling](../../scheduling/scheduling.md) subject, and a scraper **rides
that machinery**; a private timer loop inside the scraper re-answers every
question that subject already answered, worse. What this technique owns is
the scrape-specific layer: cadence as a politeness decision, the enable
switch as a first-class state, and what run history must record for a
pipeline whose failures are silent by nature.

## Cadence is a courtesy decision before it is a freshness decision

Everywhere else in a system, schedule frequency is a trade between freshness
and compute you own. Here the resource being spent is **someone else's
server**, which inverts the default: start from the slowest cadence the use
case tolerates, not the fastest the infrastructure allows.

- **Bound cadence by the source's rate of change.** Scraping hourly a page
  that updates weekly buys 167 identical harvests per real change — each one
  an imposition on the host and a no-op reconciliation for you. The
  reconciliation summary already measures this: a run history that is
  overwhelmingly `unchanged` is the system reporting its own cadence is too
  hot, and mature pipelines read that signal and stretch.
- **Prefer off-peak hours for the source's audience**, jitter start times
  rather than firing at the top of the hour alongside every other cron on
  the internet, and let per-request spacing (the fetcher's politeness
  posture, set by the golden path's legitimacy rules) stay in charge
  *within* a run. Cadence controls how often runs begin; it never licenses
  aggression inside one. The craft version of jitter is **deterministic,
  seeded by the schedule's own identity**: hash the schedule id into an
  offset within the cadence window, so many scrapes sharing one cadence
  template spread across it instead of all collapsing to the same minute —
  while each schedule's fire time stays stable across restarts instead of
  re-rolling. Random jitter re-drawn at every boot gives up both halves.
- **One target, one flight.** Overlap of two harvests against the same
  target is doubly wrong here — it doubles load on the host *and* corrupts
  reconciliation (two runs racing to reconcile interleave their absence
  processing). Skip-if-running is the correct overlap policy for scrapes,
  per the scheduling subject's overlap technique; a skipped run is recorded
  as skipped, not silently absorbed.

## Enabled is a state, not a deletion

Every scrape schedule carries an explicit **enable switch**, because pausing
is a routine event in this domain: the target redesigned and rules await
re-authoring; the dataset is under investigation; the site asked for a
pause; a terms review is open. Pausing must therefore be *cheap, reversible,
and honest*:

- Disabling stops future runs without touching rules, dataset, history, or
  baselines — everything needed to resume intact. Deleting a schedule to
  stop it (and re-creating it to resume) is the antipattern; it destroys
  run history precisely when someone paused *because something looked
  wrong*.
- A disabled schedule **shows why and since when** — a pause with a recorded
  reason invites resumption; a bare toggle invites archaeology.
- New schedules default to **disabled until first verification** — armed
  only after the rules have passed a [dry-run-preview](dry-run-preview.md)
  against the live page. Creating a schedule is not consent to run
  unverified rules tonight.
- The schedule names its reaper: when the rule set or its dataset is
  deleted, the schedule goes with it in the same operation. An orphaned
  scrape schedule is worse than an orphaned job elsewhere — it keeps
  spending a third party's bandwidth on results nobody reads.

## Failure honesty at the run level

The scheduler is where per-run failures either escalate or evaporate. For
scrapes, the run outcome vocabulary must distinguish at minimum:

- **succeeded** — fetched, extracted above baseline, reconciled; carries the
  reconciliation summary (new / changed / unchanged / absent counts).
- **collapsed** — fetched fine, extraction fell through the floor
  ([shape-change-detection](shape-change-detection.md)'s verdict). This is a
  *failure* outcome even though every fetch returned success — the run
  vocabulary is exactly where zero-rows-success gets laundered into a green
  dashboard if the vocabulary lets it.
- **blocked** — the target is refusing or throttling (denial status codes,
  challenge pages, a robots change). Blocked is not retried like an outage:
  hammering a host that just said no is how a pause becomes a ban. Blocked
  pauses the schedule (or stretches cadence sharply) and pages a human —
  the [retry-backoff](../../retry-backoff/retry-backoff.md) posture for
  "the counterparty declined" rather than "the network hiccuped".
- **errored** — infrastructure failure on our side of the conversation
  (network, engine crash, partial fetch). Retriable with backoff; a partial
  harvest never reconciles absence.
- **skipped** — overlap or pause. Recorded, so a run that never happened is
  distinguishable from one that vanished.

Consecutive non-success runs escalate on policy — N collapses or blocks in
a row disable the schedule with reason recorded, rather than firing
forever into a redesigned or hostile target. An unattended scraper that can
fail nightly for a month without a human hearing about it will; the
escalation rule is the difference between a pipeline and a liability.
