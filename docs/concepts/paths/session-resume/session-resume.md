---
layer: golden-path
subject: session-resume
status: forged
techniques:
  - last-seen-anchors
  - delta-briefings
  - first-run-and-quiet-silence
  - layered-place-restoration
  - content-freshness-states
  - resume-affordances
evidence:
  - src/features/home/sub_welcome/lib/sinceLeftBriefing.ts       # last-seen anchor frozen before the heartbeat advances it; deltas derived from stores the boot fills; quiet on first run and on no news
  - src/features/home/sub_welcome/useResumeContext.ts            # ranked resume banner (failure > unfinished tour > last edit); validated at render; per-kind expiry; null renders nothing
  - src/features/home/sub_releases/useLiveRoadmap.ts             # fresh/cached/stale/unavailable as distinct statuses; bundled fallback; polling paused while unwatched
  - src/hooks/utility/interaction/useScrollRestoration.ts        # per-context scroll positions; new-context-to-top vs return-restores; virtualization-aware settle retry; test clear hatch
  - src/stores/slices/pipeline/channelSlice.ts                   # per-team seen-watermark advanced from the newest OBSERVED item on acknowledgment, not from the clock — the anchor's per-surface scope and its consumption species
counter_evidence:
  - src-tauri/src/engine/project_tracking/push.rs                # the OTHER away-digest: two enable gates whose intersection is empty by construction — zero digests in 99 days, and the silence was indistinguishable from a quiet week
deviations:
  - w12-session-resume   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Session resume & away-briefings

An application that lives across sessions owes the returning user two things:
put them back where they were, and tell them what happened while they were
gone. Most applications deliver neither by design. Place restoration accretes
— some scroll positions happen to survive, the section resets to a default,
the half-finished draft is simply gone — and the away-briefing either does
not exist or is a firehose that mentions everything and therefore
prioritizes nothing. The user learns the return ritual by heart:
re-navigate, re-orient, re-scan every surface asking "did anything change?"
That ritual is the cost of an undesigned resume, paid on every launch,
forever.

This subject owns the **user's** continuity across absence: the durable
anchor that defines "away," the deltas derived from it, the layered
restoration of place, and the affordances that offer — never impose —
resumption. Its neighbors own the machinery underneath. The mechanics of
persistence — which store fields survive restart, how persisted shapes
migrate across versions — are
[client-state](../client-state/client-state.md), specifically
[persistence-and-migration](../client-state/techniques/persistence-and-migration.md).
The warm caches that let a restored view paint instantly instead of
re-ghosting are
[warm-remount-caches](../client-fetch-cache/techniques/warm-remount-caches.md)
in [client-fetch-cache](../client-fetch-cache/client-fetch-cache.md) —
resume across a process restart is the same policy those caches apply
across a view's unmount, stretched over a longer death. The plumbing that
can express "return to section X, entity Y" — location as serializable
state — is [app-shell](../app-shell/app-shell.md)'s
[navigation-model](../app-shell/techniques/navigation-model.md). And the
boundary that names this subject:
[agent-memory](../agent-memory/agent-memory.md) is the *agent's* memory of
what it did and learned; this subject is the *user's* place and the user's
briefing. The two meet at the return surface but never share storage or
semantics.

## One durable anchor, and everything derives from it

The entire "what changed while you were away" capability reduces to a
single durable value: the **last-seen anchor** — a timestamp (or position,
or cursor) recording the last moment the user was demonstrably present.
Everything else is derivation: "new since," "changed since," "finished
while you were gone" are all comparisons of current state against the
anchor. Get the anchor right and the briefing is a filter; get it wrong
and no amount of downstream cleverness recovers the lost delta.

The anchor's write discipline carries the correctness. It advances **on
interval while the user is present** — so a crash loses minutes, not the
session — and **on departure**, so a clean exit records the true boundary.
And it is read **before** anything advances it on return: the briefing
derives from the *old* anchor, then the anchor stamps forward. An anchor
advanced on arrival, before derivation, erases the very delta it exists to
expose — the single most common way this feature silently breaks. The
law is [gate-sees-target](../_laws.md#gate-sees-target) wearing a product
face: "seen" must mean the user could actually have seen it. An anchor
that advances while the window is hidden or unfocused claims sight that
never occurred, and the briefing built on it will omit exactly the events
the user missed. The full write/read protocol, granularity choices, and
storage rules are [last-seen-anchors](techniques/last-seen-anchors.md).

## Briefings are derived, never fetched

A since-you-left summary that issues its own volley of requests at launch
is a design failure twice over: it taxes the most contended moment in the
application's life (startup), and it couples the briefing's availability
to the network at exactly the moment the network is least trustworthy.
The rule: **the briefing derives from data the boot already loads.** If
startup fills stores with recent activity, notifications, and entity
state anyway, the briefing is a set of filters over those stores with the
predicate "after the anchor" — zero marginal fetches, available the
moment the stores are, and cheap enough to compute on every launch and
discard unsaid. The briefing may *wake* the shared loaders when they are
cold — kicking a store's own guarded, deduplicated fetch is fine — but
it owns no requests of its own. If a proposed briefing line needs data
nothing else loads, that is pressure to question the line, not license
to add the fetch. Selection, ranking, phrasing, and the cap that keeps a briefing a
briefing are [delta-briefings](techniques/delta-briefings.md).

## Silence is a designed state

The briefing that fires on every launch regardless of content is an
anti-feature. On **first run** there is no anchor, everything is
technically "new," and a briefing saying so is noise wearing a welcome
mat — first run says nothing. When **nothing significant happened**, the
correct render is nothing at all: no empty shell, no "you're all caught
up" card demanding its own dismissal. Attention is a budget; every
briefing that says nothing spends trust the next real briefing needed. An
empty briefing rendered anyway trains users to ignore briefings — and a
trained-away user misses the one that mattered. The engineering
obligation underneath is
[failure-not-empty-success](../_laws.md#failure-not-empty-success):
"nothing happened" and "could not determine what happened" (no anchor,
store not loaded, derivation failed) are different states, and only the
first earns silence by design — the second is silence by accident, and it
must at least be distinguishable in telemetry. The obligation extends to
the whole pipeline: a briefing system whose engine never runs at all is
the same silence, indefinitely — the most instructive failure on record
is an away-digest engine that produced zero digests for ninety-nine days
behind two enable gates whose intersection was empty by construction,
and nothing inside the product could tell that from a quiet quarter.
Silence must be falsifiable. Thresholds, suppression rules, and the
first-run contract are
[first-run-and-quiet-silence](techniques/first-run-and-quiet-silence.md).

## Place restoration is layered

"Put me back where I was" is not one feature; it is a stack of them, and
each layer is a separate decision:

1. **Route** — which section and view the user was in.
2. **Scroll** — where in that view their eyes were.
3. **Active entity** — which item was selected, open, or focused.
4. **In-progress work** — the half-written draft, the wizard mid-step,
   the composition not yet sent.

Each layer restores over a declared lifetime with declared invalidation —
and the value and the danger both increase with depth. Restoring a route
is safe almost forever; restoring scroll into a list whose contents
changed is mildly wrong; restoring a draft over an entity someone else
edited is a conflict that needs a merge posture. The discipline is not
"restore everything" — it is that **every layer declares whether it
restores**, so a missing layer is a decision on record rather than a gap
nobody chose. An audit that walks the four layers surface by surface
reliably finds the undeclared holes — the long
[chat transcript](../chat-transcript/chat-transcript.md) whose per-thread
reading position nobody kept, the wizard that forgets its step. The
per-layer contracts are
[layered-place-restoration](techniques/layered-place-restoration.md).

## Remote content carries freshness states

Surfaces fed by remote or optional content — news, release notes,
roadmap, anything fetched rather than owned — face their hardest moment
at resume: the network may be absent, the cache may be from last week,
and the panel must render *something* honest. The contract is four
distinct states, each a distinct render: **fresh** (fetched this
session), **cached** (last session's answer, painting now, refreshing
behind), **stale** (cached beyond its belief window — still shown, but
marked), and **unavailable** (no cache, no network — the **bundled
fallback** ships inside the application precisely so this state has
content). A blank panel because the network was down at launch is the
forbidden render; it converts a connectivity blip into an apparent
product defect. The state machine, belief windows, and fallback layering
are [content-freshness-states](techniques/content-freshness-states.md).

## Resumption is offered, not imposed

The anchor knows where the user *was*. It does not know why they left or
what they returned to do — and the resume design must not pretend
otherwise. Shallow restoration happens automatically because it is cheap
to undo: landing in the last section costs one click if wrong. Deep
restoration — reopening the draft, jumping into the entity, replaying the
half-finished flow — is **offered**: a banner or card that says "you were
working on X — continue?" and steps aside if declined. Teleporting the
user into last session's context ambushes the majority who returned for
something else, and the deeper the teleport, the harder the escape. The
depth-to-consent mapping, dismissal semantics, and expiry of the offer
are [resume-affordances](techniques/resume-affordances.md).

## The techniques

- [last-seen-anchors](techniques/last-seen-anchors.md) — the durable
  anchor: write cadence, read-then-advance ordering, presence honesty,
  granularity from global to per-entity.
- [delta-briefings](techniques/delta-briefings.md) — deriving the
  since-you-left summary from already-loaded state: selection, ranking,
  the cap, counts that carry predicates.
- [first-run-and-quiet-silence](techniques/first-run-and-quiet-silence.md)
  — silence as the designed output for first run and no-news; the
  designed-silence versus accidental-silence boundary.
- [layered-place-restoration](techniques/layered-place-restoration.md) —
  route, scroll, entity, in-progress work: per-layer lifetime,
  invalidation, and the declared-absence rule.
- [content-freshness-states](techniques/content-freshness-states.md) —
  fresh/cached/stale/unavailable as four renders; bundled fallbacks; the
  ban on blank panels.
- [resume-affordances](techniques/resume-affordances.md) — automatic
  shallow restore, offered deep restore, dismissal and expiry of the
  offer.
