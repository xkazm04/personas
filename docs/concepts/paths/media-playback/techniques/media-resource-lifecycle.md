---
layer: technique
subject: media-playback
technique: media-resource-lifecycle
status: forged
laws: [creation-names-reaper, derivation-names-recomputation]
shared_with: []
---

# Media resource lifecycle

Playback is the most resource-hungry thing most products do, and its
resources are the kind the platform will not clean up for you: decoded audio
runs to megabytes per minute, minted in-memory URLs pin their backing bytes
until explicitly revoked, playback elements hold device handles, foreign
frames are whole embedded documents, and derived artifacts (waveforms,
thumbnails) accumulate per source forever if allowed. The technique is
[creation-names-reaper](../../_laws.md#creation-names-reaper) applied to
this inventory — at creation, every one of these names what destroys it,
and on *which paths* — because the paths are where media leaks live:
completion is always handled, but interruption, failure, supersession, and
the surface unmounting mid-playback are the four exits nobody tests, and a
resource reaped on one exit and not the others leaks exactly as often as
users behave unexpectedly.

The subject's signature defect makes the stakes concrete: **audio that keeps
playing after its surface is gone.** It is always this technique failing —
a playback handle whose reaper was tied to a happy path — and it is the
worst defect a media feature can ship, because the user cannot see, find, or
stop a sound with no surface. Reapers for audible resources are therefore
bound to the *owning scope's* teardown (the component, the session, the
channel), not to the content's natural end.

## The inventory, reaper by reaper

**Minted in-memory URLs.** Generated data — a rendered mix, a recorded
capture, a decrypted asset — gets a locally minted URL so an engine can play
it. The mint pins the backing memory; the runtime never collects it while
the URL lives, and *cannot know* when you are done — revocation is entirely
the product's duty. The pattern is **latest-wins with reap-on-replace**: the
holder of the URL slot revokes the old one when writing a new one, and
revokes the current one at teardown. The leak mode is a mint inside a
re-runnable path (an effect, a retry, a regenerate button) with revocation
only at teardown: each rerun strands the previous allocation, invisibly,
megabytes at a time. One slot, two reap points — replace and teardown —
closes it.

**Decoded buffers.** Decoded media dwarfs its encoded source by an order of
magnitude or more. Buffers are held under an explicit **budget** with an
eviction policy, and the right policy is distance-from-playhead: what is
near the clock (behind for instant replays, ahead for the lookahead window)
stays; what is far goes — recomputable from the encoded source, which is
exactly what makes eviction safe
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
in buffer form: the decoded form is a derivation, the decoder is its named
recomputation, so the cache is never the only copy).

**Playback elements and pipelines.** Engine instances hold device handles,
network connections, and decode state. Two lifecycle strategies exist, and
the choice is deliberate: **create-per-use** (simple, correct by
construction, right for occasional playback) versus **pooling** (a small
fixed set of elements, acquired and released, right when creation latency
or platform per-element limits bite — some platforms cap concurrent media
elements or charge a gesture-permission cost per fresh element). A pool
changes the reaper's job from destruction to *restoration*: a released
element is stopped, unloaded, silenced, and stripped of listeners before it
re-enters the pool, because a pooled element that keeps its old event
handlers replays the previous owner's callbacks into the next owner's
context — the reuse bug that makes pooling infamous. The pool itself is
bounded and named (who empties it at session end), or it is a leak with a
capacity.

**Foreign frames.** An embedded third-party player is a whole document with
its own network, script, and audio life. Its reaper is removal from the
document *plus* the adapter's shadow-state teardown (watchdogs disarmed,
bridge listeners unsubscribed). Hiding a frame does not reap it — a hidden
frame keeps playing, which is the audio-with-no-surface defect built from a
single style property.

**Subscriptions, tickers, watchdogs.** The clock's subscriber list, the
frame-loop, transition watchdogs — every one returns its disposer at
creation, and the disposer runs on all four unhappy exits. These are small,
but they are the resources whose leak is *behavioral* rather than
memory-shaped: a leaked clock subscriber keeps computing against a dead
surface; a leaked watchdog fires into a context that no longer exists.

## Derived artifacts: waveforms, thumbnails, and their kin

Visual derivatives of media — the waveform under a scrubber, filmstrip
thumbnails, loudness contours — are expensive to compute and trivially
cacheable, and both properties tempt products into treating the cache as a
store. The discipline is the derivation law, fully applied:

- the artifact's **cache key is the full derivation tuple** — source
  identity, the parameters that shaped it (resolution, dimensions, channel
  mix), and the version of the algorithm that produced it. The precise rule:
  the key needs every component that can *vary within the cache's lifetime*.
  A session-scoped in-memory cache may legitimately omit the algorithm
  version — the algorithm cannot change mid-session — but a persisted cache
  may not, and promoting a session cache to a persisted one without
  revisiting the key is a stale-artifact bug with a delay fuse: omit the
  version and every improvement to the derivation ships only to new sources;
- concurrent requests for the same artifact **deduplicate on an in-flight
  registry** — the second caller awaits the first computation instead of
  launching a duplicate — and a failed computation removes its in-flight
  entry, so failure is retryable rather than cached forever as a pending
  promise;
- the artifact is **recomputable by a named path** and the cache is
  evictable under the same budget thinking as buffers — never the system of
  record, so eviction is a performance event, not data loss;
- computation is **owned and cancellable**: derivation of a large source is
  real work, it runs off the interactive path, and a source removed or
  replaced mid-derivation cancels the job — the derivation job is itself a
  resource that names its reaper.

## Memory pressure is a designed input

A media product decides *in advance* what it sheds under pressure, in what
order: far-from-playhead buffers first, then derived-artifact caches, then
pooled idle elements — and never the authoritative state (the clock, the
composition model, the blacklist), which is small precisely so it never has
to be shed. Where the platform offers pressure signals, they trigger the
same eviction paths the budget already exercises; a product whose only
response to pressure is the platform killing it chose that outcome at
design time by having nothing else to offer.
