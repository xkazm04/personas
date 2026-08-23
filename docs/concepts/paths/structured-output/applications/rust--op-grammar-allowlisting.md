---
layer: application
subject: structured-output
technique: op-grammar-allowlisting
stack: rust
---

# The companion op dispatcher — a closed grammar with a cleaned display channel

`src-tauri/src/companion/dispatcher/` (4,467 lines) is the repo's
fullest rendition of the technique: it scans the assistant's **finalized**
reply text for `OP: {"op": …}` proposals, validates them against closed
vocabularies, creates approval rows or auto-fire events, and returns
`Dispatched.cleaned_text` — the reply with every machine line stripped,
"safe to display" — plus typed collections per op family. The module doc
states the discipline: "ops are message-level … no agentic mid-turn loop",
and fenced code blocks are explicitly display-only, never parsed.

## Confirmed against the technique

- **Closed vocabulary, one definition**: `ALLOWED_ACTIONS: &[&str]`
  (`dispatcher.rs:239`), with `action_is_allowed()` (`:435`) as the public
  probe. Route and lab-mode arguments have their own closed sets
  (`ALLOWED_ROUTES:525`, `ALLOWED_LAB_MODES:508`).
- **Unknown ops are data, not action**: an envelope whose action is not
  allowlisted is rejected with a warning (`"rejected unknown action"`,
  `:2408-2412`) and the line is *kept in the display text* — rendered
  inertly, exactly the technique's "may be displayed" option. Tests pin
  the negative space: `assert!(!ALLOWED_ACTIONS.contains(&"show_ship_milestone"))`
  (`:3356`) — capability absence asserted, not assumed.
- **One dispatch door**: all op families flow through `dispatch_with_sys`;
  session-side effects are queued as typed vectors on `Dispatched` and
  applied by one caller. Consequential actions become
  `companion_approval` rows — the hand-off to the approval pipeline
  (the hitl-approval subject's consent gates) — while the auto-fire arms
  (`open_route`, `compose_dashboard`, canvas controls) are each justified
  in comments as reversible view-state or already-requested surfaces.
- **Reference validation before acting**: canvas slugs are resolved
  "against the PUBLISHED scene, so a demo island or an invented name never
  reaches the frontend" (`:59-61`); tour steps pass
  `validate_tour_spec` against the generated anchor manifest, and an
  unknown anchor rejects the whole tour (`:97-101`); `write_fact` without
  source episode ids is rejected at parse time as an anti-hallucination
  guard (`:2414-2434`).
- **Bounded syntactic repair, never semantic**: `repair_op_json`
  (`:693-707`) appends only missing closing braces, only when the line
  does not end inside a string literal — motivated by a live incident
  (2026-07-04: an 1,100-char op missing exactly its final brace, where
  "the assistant prose claimed a dispatch that never landed"). This is the
  extraction-strategies ladder's tolerant-repair rung implemented at the
  dispatch boundary, with the technique's "deterministic completion, never
  a guess" constraint stated in the comment.
- **Two channels, enforced by construction**: machine lines (`OP:`,
  `PROGRESS:`, `TTS:`, `QR:`) are stripped into their typed fields;
  mid-line `OP:` markers keep the prose before the marker for display and
  strip only the payload (`:667-691`); the frontend mirrors the strip
  (`stripModelDirectives`) so raw payloads never render.

## Deviations, kept against the standard

1. **Malformed ops are warned, not counted.** `Dispatched.warnings` is
   "logged but otherwise silent" (`:121-123`); there is no persistent
   counter or sample store, so unknown-op *rate* — the technique's
   prompt-drift alarm — cannot be trended. The one live incident that
   motivated `repair_op_json` was found by a human reading logs, which is
   the failure mode counters exist to replace.
2. **The grammar's three renderings are not derived from one authority.**
   The prompt menu (companion system prompt), `ALLOWED_ACTIONS`, and the
   per-arm `match` in `dispatch_with_sys` are hand-kept in sync; tests
   assert individual absences, but no check asserts menu ≡ allowlist ≡
   dispatch arms. The auto-fire families (handled as special-case arms,
   deliberately outside `ALLOWED_ACTIONS`, `:2340`) make the true grammar
   the union of two structures — correct today, and exactly the shape the
   one-authority law warns will drift when the next op is added to only
   one of them.
