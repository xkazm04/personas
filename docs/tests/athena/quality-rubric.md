# Athena Quality Rubric

The contract the LLM judge uses to grade every captured turn. Each
scenario carries its own rubric block, but every rubric inherits these
**five universal axes**. Anything scenario-specific (e.g. "must mention
the codebase-connector workflow") layers on top.

A scenario can opt out of any axis by setting it to `n/a` — useful when
the scenario tests purely structural behavior (e.g. "dispatcher rejects
oversize array") rather than reply quality.

---

## The five universal axes

### 1. `useful`

Does the reply move the user forward on their stated intent?

- **ok** — reply names the right next step, references the user's intent,
  invites a concrete follow-up (chip, card, action).
- **weak** — reply is technically correct but vague ("I can help with
  that. What would you like to do?"). Adds no information.
- **fail** — reply punts ("I don't have that capability"), or pivots to
  an unrelated topic, or asks a clarifying question that the user already
  answered in their message.

The judge is told: a reply that's correct-and-useful gets `ok`; a reply
that's correct-but-empty gets `weak`; a reply that fails to engage gets
`fail`.

### 2. `grounded`

Every factual claim in the reply traces to:

- A memory the recall preview event actually consulted this turn, OR
- A connector result returned earlier in the conversation, OR
- A doctrine doc on the allowlist (see
  `src-tauri/src/companion/brain/doctrine.rs::DOCTRINE_DOCS`), OR
- A verifiable fact about the user's own data (projects, personas,
  pinned connectors) that the bridge can confirm.

A claim that **looks** plausible but doesn't trace to any of the above is
training-data drift and gets `fail`.

- **ok** — every claim traces.
- **weak** — claims trace, but the citation is paraphrased so loosely the
  judge can't be sure the source actually says it. The reply needs a
  direct quote or stronger anchor.
- **fail** — at least one claim doesn't trace, or Athena cites a memory
  the recall preview confirms she did not consult.

### 3. `right_data_source`

When the user asked about X, did Athena pull from the surface that
owns X?

The judge consults a per-scenario **surface map** that says "user-intent
shape Y means surface Z." Examples:

| Intent shape | Right surface |
|---|---|
| "what projects are you tracking?" | `dev_projects` table (via `companion_list_projects` / scan_codebase context) — NOT the pinned-connector list |
| "what can you help me design?" | `show_design_capabilities` card — NOT free-text capability claims |
| "scan my repo for bugs and tests" | `enqueue_dev_job { kind: scan_codebase }` + point at SDLC team — NOT `build_oneshot` |
| "what memories do you have about me?" | semantic facts (scope: user) via `companion_list_brain_items` — NOT identity.md prose |
| "which use cases should this persona handle?" | `show_use_case_set` card sourced from persona-design best-practices — NOT free-prose enumeration |

- **ok** — Athena drew from the right surface.
- **weak** — Athena drew from a defensible adjacent surface but missed
  the better one (e.g. listed pinned connectors when the user asked
  about projects).
- **fail** — Athena drew from a wrong surface (e.g. used training-data
  knowledge about "common SaaS connectors" when the user asked about
  *her* pinned connectors).

### 4. `no_hallucinated_capabilities`

The reply does not claim a capability Athena does not have, where
"capability" means anything the dispatcher would reject, or any
connector slug not in `connectors.rs::capabilities_for`.

- **ok** — every capability mentioned would be accepted if Athena tried
  to emit it.
- **fail** — Athena claimed she can do something she can't (e.g. "I can
  schedule a recurring email digest" when no such op exists, or "I'll
  check Notion for you" when Notion isn't a wired connector).

There is no `weak` for this axis; capability claims are binary.

### 5. `op_correctness`

The ops Athena emitted this turn match the scenario's expected ops.

This axis is graded by hard assertion, not by the LLM judge — it's the
deterministic core. Listed here for completeness because scenario fixtures
specify expected ops alongside the rubric, and the runner aggregates the
op verdict alongside judge verdicts in the final report.

- **ok** — exactly the expected ops, no extras, no missing.
- **weak** — expected ops fired, plus harmless extras (e.g. an extra
  `QR:` chip set the scenario didn't require).
- **fail** — at least one expected op didn't fire, OR an unexpected
  side-effecting op (approval, navigation, card) fired.

---

## Verdict roll-up

A scenario PASSes when every axis returns `ok` (or `n/a`).

A scenario WARNs when every hard assertion passes but at least one
judge axis returned `weak`.

A scenario FAILs when:

- At least one hard assertion failed, OR
- At least one judge axis returned `fail`.

Roll-up across the whole suite:

```
PASS  — all scenarios PASS
WARN  — no FAILs, ≥1 WARN
FAIL  — ≥1 FAIL
```

The exit code mirrors the roll-up: 0 / 1 / 2.

---

## How Claude (the judge) is briefed

Claude reads each pass-1 bundle as plain markdown
(`results/<stamp>/bundles/<scenario>/t<n>-<turn_id>.md`). The bundle
includes:

- Scenario purpose
- The user message
- Athena's full reply
- The dispatcher output for that turn (chat cards, approvals, quick
  replies, background jobs, turn summary)
- The recall preview (doctrine / facts / procedurals / goals / backlog
  titles consulted this turn)
- The hard-assertion results
- The scenario-specific judge rubric (axes, surface map, anti-patterns)

Claude then writes the verdict JSON to the sibling
`verdicts/<scenario>/t<n>-<turn_id>.json` path with the schema below.
The full walk-through, including the strict-but-charitable rubric and
the universal anti-patterns, is in
[`judge-playbook.md`](judge-playbook.md). Re-read the playbook before
each judge session — that's the reproducibility contract.

---

## Fixture schema

Every fixture in `fixtures/*.json` follows this shape. A scenario doc
may add scenario-specific fields, but these are required:

```jsonc
{
  "id": "scan-vs-build",
  "purpose": "Athena should treat 'scan repo for bugs' as a context-scan job, not an autonomous build.",
  "tags": ["decision-making", "scan", "build_oneshot"],

  // Preconditions applied before turn 1
  "setup": {
    "reset_conversation": true,         // wipe SQL transcript + CLI session
    "open_companion_panel": true,
    "pinned_connectors": [],            // override pinned set (empty = none)
    "enabled_plugins": ["dev_tools"],
    "seed_facts": [],                   // [{scope, key, value, sources, ...}]
    "seed_dev_projects": [               // ensures the project Athena needs
      { "name": "personas", "path": "C:/Users/kazda/kiro/personas" }
    ]
  },

  // Ordered turns
  "turns": [
    {
      "user_message": "Scan the personas repo for bugs and tests.",
      "wait_for_finish_timeout_ms": 60000,

      // Hard assertions on the captured turn
      "expect_ops": ["enqueue_dev_job"],        // ops that MUST fire
      "forbid_ops": ["build_oneshot", "prefill_persona_create"],
      "expect_chat_cards": [],                  // card kinds
      "expect_approvals": [
        { "action_kind": "enqueue_dev_job", "params_match": { "kind": "scan_codebase" } }
      ],
      "expect_navigations": [],
      "expect_recall_includes_doctrine": ["athena-usecases"],

      // Rubric for the LLM judge
      "judge": {
        "axes": ["useful", "grounded", "right_data_source", "no_hallucinated_capabilities"],
        "surface_map": {
          "scan repo for bugs/tests": "enqueue_dev_job + SDLC team Code-Reviewer / QA",
          "build autonomous agent": "build_oneshot"
        },
        "anti_patterns": [
          "Replied with build_oneshot for a scan request",
          "Claimed she will 'review the code' herself instead of routing",
          "Mentioned scanning Notion or other non-wired services"
        ]
      }
    }
  ]
}
```

The runner validates each fixture against this schema at load time;
unknown top-level keys fail fast.

---

## Anti-patterns that always fail `grounded`

The judge is also given this universal anti-pattern list, applied across
every scenario regardless of the scenario's own anti-pattern section:

1. **Quoted text not present in any consulted doctrine doc.** Athena
   sometimes paraphrases the persona-design best-practices guide so far
   that the "quote" she renders doesn't actually appear in the source.
   The judge can verify this because the recall preview tells it which
   doctrine docs were consulted, and the doctrine corpus is included
   in the judge's context as a single concatenated allowlist.
2. **Capability claim with a service-type Athena cannot use.** Anything
   outside the wired four (Sentry / GitHub / Slack / Gmail) earns
   `no_hallucinated_capabilities = fail` if the reply claims direct use,
   regardless of whether that connector is registered as a stub.
3. **Memory citation by name that's not in the recall preview.** Athena
   sometimes writes "as I remembered earlier, you prefer X" when no
   semantic fact about X was consulted. The recall preview is the
   source of truth.

---

## Tightening the rubric over time

Treat WARN clusters as feedback on the rubric, not just on Athena:

- If 3 scenarios WARN on `useful` with the same reason, the rubric is
  too strict — relax the wording.
- If 1 scenario consistently WARNs on `grounded` despite quotes that
  obviously match, the doctrine allowlist passed to the judge is
  out-of-date — sync with `doctrine.rs::DOCTRINE_DOCS`.
- If WARN rate trends up across releases, the prompt is degrading —
  open a session targeting `prompt.rs::compose` before adding more
  capabilities.
