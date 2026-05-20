# Build Readiness Redesign — making `ready` mean "will deliver value"

## Why this exists

The 50-template adoption marathon (2026-05-20) ran ~149 persona
executions. Only **22 delivered business value**; 59 returned
`no_input_available`, 59 `precondition_failed`. **34 personas were
promoted `setup_status='ready'` and delivered value on zero runs.**

A 5-persona verification re-run split the failures:

- **3 of 5 were healthy** — the persona reached the *real* source
  (Gmail inbox, survey DB), did real work, and correctly found nothing
  to act on. A real event would have produced value. These are a
  test-method artifact, not a defect.
- **2 of 5 were genuinely broken** — `Sales Deal Intelligence` ("No CRM
  connector is wired") and `KB Review Cycle Manager` ("only Gmail
  credentials provisioned. No Notion token"). In both, the user **had
  the credential in the vault** (`attio`, `notion`) — it simply never
  reached the persona's execution. The build promoted them `ready`
  anyway.

So `ready` is hollow. It does not mean "this persona will deliver value
when triggered." This document is the redesign that makes it mean that.

## The four gaps

### Gap 1 — Abstract connector roles are never bound to a concrete credential

A template declares a connector by an abstract *role* (`crm`, `email`,
`knowledge_base`). The user's vault holds a *concrete* credential
(`attio`, `gmail`, `notion`). Nothing reliably binds the two.

- The build-time `credential_bindings` map
  (`engine/adoption_answers.rs`) is built **entirely on the frontend**
  by `deriveCredentialBindings` (`vaultAdoptionMatcher.ts`), and only
  when an adoption question carries `vault_category` +
  `option_service_types` or a `dynamic_source:{source:vault}`.
- `apply_credential_bindings_to_connectors` only **rewrites existing**
  `required_connectors` placeholders on an exact-string-key hit; a miss
  is a documented no-op.
- The runtime never reads `credential_bindings` at all
  (`extract_credential_bindings` is `#[allow(dead_code)]`).

**Result:** a template connector with no covering vault-category
question reaches runtime with its name still the abstract role. The
runtime credential resolver (`runner/credentials.rs`) then looks up the
vault by that literal role string, finds nothing, and injects no
secret. The persona executes blind.

The runtime DOES have a per-persona binding map —
`design_context.credentialLinks` (`connectorName → credentialId`),
honored first by `inject_design_context_credentials`. It is just never
populated for uncovered connectors.

### Gap 2 — Promotion is gated on nothing real

The build "test" (`build_session/tool_tests.rs`) only verifies a
connector's credential authenticates against a read-only GET endpoint.
It never runs the persona, its prompt, or its use-cases. `cli_native`
and built-in connectors auto-pass; an empty `test_plan` falls back to
"credential present = passed."

Promotion is a pure phase-state-machine transition. The interactive
path advances `test_complete → promoted` unconditionally (and can skip
testing entirely, `draft_ready → promoted`). The only conditional is
the `setup_status='needs_credentials'` dashboard flag — a warning, not
a block. A persona that authenticates but delivers nothing sails
through.

### Gap 3 — The credential proxy is dead

The runtime prompt instructs the agent to fetch credentials via
`$PERSONAS_PROXY_URL/<credential_id>` with `Bearer $PERSONAS_PROXY_KEY`,
claiming both are pre-set. **Neither env var is set anywhere in the
codebase.** The proxy server itself runs (port 9420) but executions are
never told its URL. Agents waste a step discovering the proxy is
absent, then fall back to direct env-var credentials (which DO work).

### Gap 4 — The build test is not a representative execution

Because the test never runs the persona, "will this persona accomplish
its use-case" is never checked at build time. `business_outcome`
(`value_delivered` / `no_input_available` / `precondition_failed` /
`partial`) is self-reported by the agent's LLM **at runtime** and the
build never sees it.

## The redesign — four phases

### Phase 1 — Bind every connector to a concrete credential

At adopt/build, for **every** entry in `required_connectors` (not only
question-covered ones):

1. Classify it (`connector_readiness::classify_connector` — the
   connector-classification redesign already shipped). `ZeroConfig` /
   `GlobalProbe` connectors need no credential binding.
2. For a `Credential`-class connector, resolve role → concrete vault
   credential: exact `service_type` match, else category match
   (the connector's `connector_definitions.category`).
   - exactly one candidate → auto-bind;
   - several → a scope-clarifying question (Phase 4);
   - none → block / question.
3. Write the binding into `design_context.credentialLinks` — the map
   the runtime resolver already honors — so execution injects the right
   secret.

This directly fixes the two verified failures: `crm` → `attio`,
`knowledge_base` → `notion`.

### Phase 2 — Gate promotion on input-path verification

Promote runs the connector-readiness resolver over every connector AND
checks each `Credential`-class connector is *bound*
(`credentialLinks` entry resolves to a live credential). It also checks
a trigger is wired. A persona with an unbound connector or no runnable
trigger is **not** promoted `ready` — it gets an honest state and a
Phase 4 question.

### Phase 3 — Realistic build test, gated on `business_outcome`

The build `test_complete` phase runs the persona on one representative
capability with **real API calls** (the connectors are now bound, so
this is close to a real run). Promotion to `ready` is gated on the run
reporting `business_outcome = value_delivered` — or, when the capability
genuinely needs live data that does not exist yet (an empty inbox), an
explicit `ready_pending_data` state rather than a false `ready`.

Sub-fix: wire `PERSONAS_PROXY_URL` / `PERSONAS_PROXY_KEY` into the
execution environment (or remove the proxy section from the prompt) so
Gap 3 stops costing every run a wasted discovery step.

### Phase 4 — Scope-clarifying question rounds on gaps

The build already has a `pending_question` / `AwaitingInput` machinery
(today it fires only before `draft_ready`, for intent clarification).
Extend it: when Phase 1 binding is ambiguous, or Phase 3's test does not
deliver value, the build **asks the user** a scoped question
("Which CRM should this persona use — Attio or HubSpot?", "This persona
needs a Notion database to read — connect one?") instead of promoting
silently. Question rounds clarify scope; they do not paper over gaps.

## Outcome

After all four phases, `setup_status='ready'` means: every connector is
bound to a real credential, a trigger is wired, and the persona has
been run once and delivered value (or is honestly marked as awaiting
live data). The build can no longer ship a persona that authenticates
but does nothing.
