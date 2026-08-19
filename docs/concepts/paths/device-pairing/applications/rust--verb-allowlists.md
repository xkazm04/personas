---
layer: application
subject: device-pairing
technique: verb-allowlists
stack: rust
---

# The companion API's closed five-verb grammar

`src-tauri/src/commands/fleet/companion_api.rs` is the technique's
reference implementation: what a paired phone may do is a sum type, and
everything else fails to parse.

## The grammar

`CompanionAct` (`:423-443`) is a serde tag-dispatched enum with exactly
five variants — approve / reject / reply / wake / kill — and the module
docstring states the closure as the design: "`/api/act` accepts exactly
five verbs … Nothing else parses" (`:19-21`). The test drives both sides
of the closure (`act_grammar_is_closed`, `:628-647`): the five verbs
deserialize, and the plausible-forbidden sampler — `spawn` with a cwd,
`broadcast`, `write_raw` with an escape sequence — fails at the type
boundary. An unlisted verb is a 422 from the deserializer; no handler
exists to reach.

## Projection-only reads

`/api/state` returns `RemoteState` (`:290-298`), a purpose-built
projection: labels, coarse states, attention flags, and the remotely
answerable approvals. The hard rule is written where the shape is
defined: "It carries NO PTY bytes, no transcripts, no cwd paths, no
credentials" (`:24-27`). The label fallback chain is name-like only —
title → user name → project label, "Never a filesystem path"
(`:262-264`, implemented `:328-332`) — the exact fallback-audit the
technique calls for. The projection is versioned (`v: 1`, `:294`).

## Writes act only on what the projection showed

- A remote approve/reject must pass `require_remote_approval`
  (`:591-600`): the id must resolve to a **currently pending** approval
  whose action is in `REMOTE_APPROVAL_ACTIONS` (`:254`) — recomputed via
  the same `fleet_pending_approvals` filter that builds the projection
  (`:374-409`), so visibility and permission cannot drift. "The phone can
  never approve an arbitrary approval id it did not see in its own
  projection" (`:587-590`).
- A remote reply lands only on a session currently `AwaitingInput`
  (`:561-569`) — "typing into a working terminal from a phone is never
  right" — re-derived at execution time, not trusted from the client.
- Free text is hostile: `sanitize_reply` (`:469-476`) drops every control
  character except newline ("no ESC — a remote reply must never be able
  to smuggle terminal control sequences"), caps at 500 chars
  (`MAX_REPLY_CHARS`, `:61`), and the test pins the escape-stripping
  (`:618-625`).
- Every act, success or failure, writes a ledger row with the device id
  in the rationale (`audit`, `:480-502`; rule #4 of the module header).

## The borrowed control that rotted, one module over

The same repo carries the technique's cautionary tale on the P2P remote
path: `companion/remote_jobs.rs` justified running a full agent turn for
a paired device by listing the local constraints that "still constrain
her here, unchanged and unduplicated" — and one of the named constraints,
`AUTOAPPROVE_ALLOWLIST`, was deleted on 2026-08-10; the reference
survives only in comments (10 mentions, 6 files, 0 declarations —
measured in `docs/concepts/golden-paths/cross-device-pairing.md` §0.5).
A safety argument written as prose, with no import and no test, rotted
toward permissiveness within days of an unrelated refactor — while the
companion API's enumerated verbs, enforced in its own code, were
untouched by the same change. The two paths, side by side, are the whole
argument for structural allowlists.
