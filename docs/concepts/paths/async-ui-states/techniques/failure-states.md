---
layer: technique
subject: async-ui-states
technique: failure-states
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Failure states

A request that fails is a fact the surface knows, and the surface must say
it. The governing law is that **failure is spelled differently from empty
success**: zero-because-nothing-exists and zero-because-the-request-died are
different claims, and a surface that renders its empty state on failure is
telling the user "you have no data" when the truth is "I couldn't look".
Everything in this technique is that law plus its consequences.

## The failure state, when nothing is held

When a request fails and the region holds no content, the region renders a
**first-class failure state**:

- **Visually and semantically distinct from empty.** Different iconography,
  different tone, different claim: the system could not answer, not the
  answer is zero. A user should be able to tell the two apart at a glance,
  because their next actions differ entirely.
- **A retry affordance that retries the same request.** Not a link to
  reload the world, not "go back and try again" — a control on the failure
  state that reissues exactly what failed, entering the loading state on
  press (with the pressed control honoring the
  [action-busy-states](action-busy-states.md) contract).
- **The user's context is preserved.** The query, the filters, the scroll
  position, the half-built input that triggered the fetch — all of it
  survives the failure. A failure that resets the user's work converts one
  incident into two.
- **Chrome stays.** Like every content state, failure occupies the content
  region only; the surface's controls remain, because adjusting the query is
  sometimes the actual fix.

## What the message says

- **State what is known, at the user's altitude.** "Couldn't load activity —
  the service didn't respond" is a claim the user can act on; a raw error
  string, a status code, or a stack fragment is the system talking to
  itself in front of a guest. Map raw failures to human phrasing at one
  place, so the mapping is consistent product-wide.
- **Never blame the user for a system failure**, and never reassure falsely:
  "something went wrong, your data is safe" is only writable when the second
  clause is *known*.
- **Distinguish the failure classes the user can act on differently**:
  unreachable (retry, check connection), rejected or invalid (fix the
  request — often a form-level concern), unauthorized (sign in or request
  access — retry is useless and offering it is noise). Where the next action
  differs, the rendering differs; where it does not, one honest generic
  failure beats a taxonomy the user cannot use.

## Failure while data is held: degrade, never destroy

A failed *refresh* over rendered content does not demote the region. The
content stays — it was true recently and is the best answer available — and
the failure is admitted ambiently: a quiet indicator that the last update
failed, ideally with **how stale** the data now is ("as of two minutes
ago"). Blanking held data because an update failed destroys the one thing
the user still had. The staleness statement is what makes this honest rather
than complacent: showing old data as if fresh is its own small lie.

## Retry discipline

- **Automatic retries happen below the surface, with backoff, bounded.** A
  region may quietly retry a transient failure before showing the failure
  state at all — but bounded in count and backing off in interval. A hot
  retry loop hammers the failing dependency at its worst moment.
- **Manual retry always remains available** once the failure state shows.
  The user knows things the system does not (the network just came back).
- **Repeated failure escalates honestly.** After retries exhaust, the state
  says so — "still can't reach the service" — rather than cycling the same
  optimistic message forever.

## Calm outside, loud inside

The failure state the user sees is calm and quiet by design — which makes it
the exact place where silent-failure rot begins. The rendering discipline
must be paired with a reporting discipline: every failure that renders (or
is ambient-admitted, or is silently retried) is also reported to telemetry.
A failure the product handles gracefully and reports nowhere is invisible in
the aggregate; the operator learns about it from users, at which point the
graceful rendering has been *hiding* an outage. Graceful degradation and
loud instrumentation are one decision, not two.
