---
layer: application
subject: prompt-assembly
technique: layered-composition
stack: rust
---

# Layered composition in the persona engine and companion (Rust)

The repo runs two prompt families with one assembler each — and one measured
counter-example where the door failed to seal.

## The persona assembler

`src-tauri/engine/src/prompt/mod.rs` is the single door for the persona
execution prompt. `assemble_prompt` (`:130`) is a thin wrapper over
`assemble_prompt_with_skills` (`:161`), which renders the whole stack in a
fixed order: `## Triggering Event` (`:239`) → `## Description` (`:271`) →
`## Identity` (`:283`) → `## Instructions` (`:293`) → event handlers, tool
guidance, examples, error handling → `## Available Tools` (`:460`) →
`## Protocol Tools` (`:471`) → `## Execution Environment` (`:490`) →
`## Available Credentials` (`:553`) → `## Connector Usage Reference`
(`:613`) → `## Communication Protocols` (`:746`) → `## Input Data` (`:876`,
fenced) → `## EXECUTE NOW` (`:888`). Identity/instructions lead; per-call
input trails — the stability gradient in section order.

Section text with a rare change cadence lives as named constants in
`prompt/templates.rs` — the protocol specs, the execution-mode directives
(`EXECUTION_MODE_DIRECTIVE` / `DELIBERATE_MODE_DIRECTIVE`), and
`DATA_HONESTY_INVARIANT` (`templates.rs:250`), a policy-layer override
injected into every runtime prompt to neutralize stale authored
instructions frozen in older personas' stored prompts — a live example of
the policy layer outranking persona-authored layers by position and
explicit precedence language.

The capability section demonstrates renderer/sidecar lockstep: when the
skills sidecar is enabled, `skills_sidecar/mod.rs` writes per-connector
SKILL.md files and the assembler shrinks `## Connector Usage Reference` to
pointers — `assemble_prompt_with_skills` takes the exact set of connectors
whose file was *actually written* (`mod.rs:152-160`), so a failed write
keeps its inline fallback rather than leaving a dangling pointer.

## The companion assembler

`src-tauri/src/companion/prompt/` states its layer stack in the module
doc — constitution → identity → observability digest → recall (us-history
vs world-knowledge kept distinct) → doctrine — and funnels everything
through one `compose()` (`:1779`), which returns the composed string
*plus* a `PromptBlockSizes` ledger. The caller runs exactly one budget
audit per composed prompt (`:269-270`), and per-block content hashes are
persisted to the turn ledger (`hashes_json`, `:1750-1757`) — the
one-door property producing, for free, the per-layer observability the
subject's fingerprinting technique asks for.

The file also carries the one-door lesson written in blood: the non-ml
recall arm used to be a local `manual_recall` that duplicated
`retrieval::retrieve` with caps hard-coded as literals — "a silent fork
which meant `retrieval`'s own non-ml arm was unreachable code, and any fix
applied there … would never have run" (`prompt.rs:295-302`). Two doors,
one dead, all fixes landing on the corpse.

## The counter-example: the door did not seal

`src-tauri/src/engine/runner/mod.rs` concatenates onto the *returned*
prompt after assembly: persona memories (`format!("{prompt_text}{mem_section}")`,
`:973`), prior human-review feedback (`:1014`), and team ledger/alignment
context (`:1042`). The 2026-08-17 reconstruction audit
([the legacy corpus study](../../../golden-paths/prompt-assembly.md))
measured these post-assembly appends at **44.5% of production prompt
bytes** — a median prompt is ~43% team-context block alone — all of it
outside the assembler's fence, budget, and fingerprint. Every append is
individually reasonable; collectively the sealed door governs a minority
of what the model reads. This is the technique's "door that can be
appended to is not a door" clause, measured at production scale.
