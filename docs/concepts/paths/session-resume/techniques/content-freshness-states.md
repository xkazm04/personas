---
layer: technique
subject: session-resume
technique: content-freshness-states
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Content freshness states

Some resumed surfaces are fed by content the application does not own —
release notes, roadmaps, news, curated feeds, anything fetched from
elsewhere and merely displayed. These surfaces meet their hardest moment
at launch: the network may be down, captive-portaled, or slow; the cache
may be from last week; and the panel must still render something honest.
The undesigned outcome is the blank panel — a surface that treats "fetch
failed" as "nothing to show" and converts a connectivity blip into what
looks like a product defect. The designed outcome is a small state
machine in which **every state has a render**, and no state renders
blank.

## The four states

- **Fresh** — fetched this session, within its belief window. Renders
  plainly; freshness is the default costume and needs no label.
- **Cached** — the disk cache answered *because it was still inside its
  belief window*, so the network was deliberately skipped. This is a
  **healthy** path, not a degraded one: it renders plainly, at most with
  a quiet timestamp, and needs no apology.
- **Stale** — the disk cache answered *as a rescue*: the network was
  attempted and failed, and the cache — possibly past its window — is
  what stands in. Same content as cached might be; **different
  meaning**: the live channel is silently broken. Still renders the
  content — old truth beats no truth — but visibly dated ("as of …"),
  because the user may act on it and the age has become material, and
  because the surface must not impersonate a working pipe.

The cached/stale line is drawn by *why* the cache answered, not by how
old the bytes are: "fresh enough to skip the network" and "the network
failed, here is what we have" are different facts about the system even
when the payload is byte-identical. A state machine that keys only on
age merges them and loses the one bit — is the live channel working? —
that operations needs.
- **Unavailable** — no cache and no successful fetch, ever. Renders the
  **bundled fallback**: content shipped inside the application itself
  (the release notes as of the build, the static edition of the feed)
  precisely so this state has something real to say. The fallback is
  labeled for what it is, and the panel carries its "couldn't reach the
  source" notice as an annotation on real content — not as the content.

The states are a strict preference order: live > cached > bundled, with
the panel always rendering the best content it has and annotating
honestly. This is the stale-while-revalidate policy
([swr-design](../../client-fetch-cache/techniques/swr-design.md) in the
fetch-cache subject) extended one level further down: where a fetch cache
bottoms out at "miss," a content panel bottoms out at the bundled tier,
because the build itself is a cache with a very long TTL.

## Distinct states, distinct truths

Collapsing any two states is a lie with a delay fuse
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- Cached-shown-as-fresh: the refresh quietly fails for a month and
  month-old content wears a fresh face. The state machine must remember
  that the *displayed* content's age is the cache's age, not the last
  attempt's.
- Unavailable-shown-as-empty: "the source has no announcements" and
  "we could not reach the source" are opposite claims; rendering them
  identically means the user cannot distinguish a quiet week from a
  broken pipe — and neither can support, reading the screenshot.
- Failed-refresh-shown-as-nothing: a refresh failure over good content
  must never demote the render to unavailable — content stays; only a
  panel that *never* had content may enter unavailable. Encode that as a
  transition guard ("unavailable only from loading"), not as a
  convention.

## Refresh behavior at resume

- **Paint first, fetch behind.** The cached tier exists so resume never
  blocks on the network. The panel renders its best tier synchronously
  and upgrades in place when the refresh lands.
- **Upgrade without a jolt.** The cached-to-fresh transition is usually
  invisible (same content) or a calm in-place update; it must never
  re-ghost the panel or reset the user's scroll within it.
- **Poll only while watched.** A panel that refreshes on an interval
  pauses when it is not visible — background tabs, hidden sections, and
  the panel's own host kept mounted behind another tab by a keep-alive
  shell (the case that bites: the component never unmounted, so its
  interval never stopped). "Watched" is a predicate over the shell's
  navigation state plus window visibility, and a paused panel re-checks
  on becoming watched again. The presence signals are the same ones the
  [last-seen anchor](last-seen-anchors.md) heartbeat trusts. Polling on
  the cache's own belief-window cadence is nearly free: a poll that
  lands inside the window is answered from disk without touching the
  network.
- **Failure is quiet and bounded.** Refresh failures retry with backoff
  and give up until the next natural trigger (visibility, next launch);
  a content panel is never worth an error toast.

## The bundled fallback is maintained content

The bundled tier only works if it is treated as content with a release
process, not as lorem ipsum behind a 404. It ships with every build, so
its worst-case age equals the installation's age — acceptable for
release notes and evergreen guidance, and the label ("as of this
version") makes the age honest. The trap is the fallback nobody updates:
three years of releases later, the unavailable state renders an
archaeology exhibit. Wire the bundled content's regeneration into the
release pipeline so it refreshes as a side effect of shipping, not as an
act of remembering.

## Decision rules

- Four states — fresh, cached, stale, unavailable — each with a render;
  blank is not a state.
- Cached means "skipped the network on purpose"; stale means "network
  failed, cache rescued" — split by cause, not by age.
- Preference order live > cached > bundled; always render the best tier
  held, annotate age from the *content's* timestamp; unavailable is
  reachable only from never-had-content.
- Distinguish "source says empty" from "source unreachable" all the way
  to the pixels.
- Paint synchronously from cache at resume; refresh behind; upgrade
  without re-ghosting or scroll reset.
- Pause polling while unwatched; resume on visibility.
- Regenerate the bundled fallback in the release process, and label it
  with its vintage.
