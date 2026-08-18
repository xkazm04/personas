---
layer: application
subject: entity-lifecycle
technique: blast-radius-computation
stack: rust
---

# The persona delete: preview, drain, receipt

The app's most safety-critical path is persona deletion, and it carries
the technique end to end: a dedicated preview command, a two-phase
destructive command, and a receipt.

## The enumeration and its door

`src-tauri/db/src/repos/core/personas.rs:1921` `blast_radius` walks the
dependent categories — active automations, triggers (bucketed by type),
event subscriptions, running/queued executions, learned memories — and
returns `Vec<(category, description)>`. The command wrapper
`persona_blast_radius` (`src-tauri/src/commands/core/personas.rs:636`)
maps it to the exported `BlastRadiusItem` struct (`:629-632`), so the
confirm dialog renders the server's enumeration, not a client guess.
The same pattern is replicated per central entity —
`credential_blast_radius` and `automation_blast_radius` have their own
repo enumerations (`repos/resources/credentials.rs:476`,
`repos/resources/automations.rs:336`) — and the vault's revoke surface
adds the what-if half: `simulateRevocation` and `analyzeBlastRadius` in
`src/features/vault/sub_dependencies/credentialGraph.ts` read the same
`BLAST_RADIUS_THRESHOLDS` object (`:74-77`), with a comment naming the
rule: "Shared source of truth so the two surfaces cannot drift."

The proportionality rule is live too:
`src/features/agents/sub_use_cases/libs/useCapabilityToggle.ts:80-106`
fetches the cascade preview first and, when it comes back empty,
applies immediately with no dialog at all.

## The act: two-phase drain, then the receipt

`delete_persona` (`commands/core/personas.rs:673`) is the ceremony the
technique asks for on a high-radius entity: `mark_deleting` blocks new
work (`:680`), the pure guard `deletion_forbidden_reason` (`:655-664`)
protects system-origin personas and is deliberately side-effect-free so
the most safety-critical check is unit-testable, running executions are
cancelled and the engine drained under a 15 s deadline (`:667`,
`:790-804`), survivors are force-cancelled before the cascade fires so
active tasks cannot write into rows being deleted (`:806-820`), the
declared cascade runs (`:823`), and the orphaned icon file on disk is
reclaimed best-effort (`:825-834`). The return is a receipt, not a
boolean: `DeletePersonaResult` (`:612-623`) reports
`executions_cancelled`, `executions_force_cancelled`,
`timeout_reached`, and `cancel_failures` — the accounting the preview's
consent gets compared against.

## Where the technique's warnings have already come true

- **A failed probe rendered as "safe to delete."** The comment at
  `repos/core/personas.rs:1941-1946` records the incident: the triggers
  probe selected a `name` column that never existed, the whole query
  errored at runtime, and "the delete dialog silently showed an empty
  blast radius." Exactly the failure-not-empty-success clause — and the
  surviving `.unwrap_or(0)` calls on the other probes (`:1933`,
  `:1982`, `:1997`) keep that door open: a probe error still becomes a
  reassuring zero.
- **A probe narrower than its delete.** The automations count filters
  `deployment_status = 'active'` (`:1929`) and the executions count
  `status IN ('running','queued')` (`:1993`) while the cascade takes
  every row — the preview omits the history behind each category.
- **Privilege parity violated.** The legacy ground-truth sweep
  (`docs/concepts/golden-paths/delete-semantics.md`) documents
  `credential_blast_radius` shipping unguarded while `delete_credential`
  is `#[requires(privileged)]` — the preview cheaper than the act.
- **The measured radius nobody previewed.** The 2026-08-17 operator
  purge (`docs/concepts/golden-path-deferred-fixes.md:16-23`) sent one
  authorized bulk delete through the declared `ON DELETE CASCADE`
  graph and took **20,342 rows across 25 tables** — all 78 personas,
  6,535 memories, 2,188 executions. The cascade behaved exactly as
  declared; the number was learned by running it.
