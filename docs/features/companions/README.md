# Companions

**Companions are the app's own agents.** Not the agents a person builds in Personas (those are
personas, and they live under Agents), but three built-in characters who look after the app, the
person's agents, and the knowledge the projects are held to. They are a first-level place in the
sidebar, below Plugins, and each one has its own pages, its own switch and its own mind.

| | Who | What it is for | It can be switched on when |
|---|---|---|---|
| **Athena** | the assistant | anything in the app: she plans, builds, remembers and answers | always (she is the only one on by default) |
| **Overseer** | keeper of the fleet | keeps every agent running without error and worth what it costs; audits each wave of work | at least one agent is starred |
| **Curator** | keeper of the registry | keeps a mapped knowledge registry world-class and applied in the projects that subscribe to it | a workspace has a knowledge registry mapped |

## The word "companion"

This is the vocabulary the codebase now uses, and it is the reason this document exists.

- **Companions** (plural, capital C) is the CATEGORY: the three above. In code, `companions_*` is
  the category's own surface: `companions_status`, `companions_set_enabled`, the
  `companions://status-changed` event, `src/features/companions/`.
- **companion** (lowercase, singular) is any ONE of them, and `companion_*` in code is the SHARED
  RUNTIME all three run on: the memory tables, the brain on disk, the cycle, the approvals. A row
  in `companion_node` belongs to whichever companion owns it.
- **Athena** is the assistant, and `athena_*` is what only she has: her chat, her voice, her tours,
  her onboarding, her night shift.

Until 2026-09-22 "companion" simply meant Athena, and the two ideas were the same thing. They are
not the same thing any more, and a `companion_*` name that means "Athena's" is now a defect.

Two words that are NOT this subject and must never be renamed into it: the **companion app**
(the mobile/web pairing surface, `plugins.fleet.pair_*`, `FleetCompanionDevice`), and Athena's
**capability toggles** (`companion_plugin_toggle`), which decide what she knows about, not whether
she exists.

## The states a companion is in

`enabled` is the person's intent; `eligible` is whether the prerequisite is met. They are kept
apart on purpose: unstarring the last agent must not silently rewrite the switch the person set.
A surface draws one of four states, derived and never stored:

| State | Meaning |
|---|---|
| `active` | enabled, eligible and onboarded: it is doing its work |
| `off` | it could run, and the person has switched it off |
| `needs_onboarding` | Athena only: the onboarding was never finished |
| `blocked` | the prerequisite is missing; the blocker names which (`no_starred_personas`, `no_registry`) |

A blocked or off companion is never hidden from the sidebar: it keeps its place on the map and its
Setup page says in one line what would wake it.

## The pages

- **Overview** (the landing): three columns, one per companion, each carrying its portrait and its
  state. A click opens that companion's Setup, except an un-onboarded Athena, who opens her own
  onboarding.
- **Athena**: Athena (her profile and onboarding), Setup, Memory, Voice, Decisions.
- **Overseer**: Overseer (the reviews), Setup.
- **Curator**: Council, Setup.

## Where the documents are

- `athena/` - everything about Athena (moved here from `docs/features/companions/athena/`).
- `overseer/` - the Overseer, formerly the Director (`docs/features/companions/overseer/`).
- `curator/` - the Curator and the Council page she hosts (`docs/features/companions/curator/council.md`).

Design and history: the idea note for this change lives in the operator's Spark vault under
`ideas/companions.md`; the character portraits and the landing contest are machine-local under
`.claude/companions-reference/` and `.contest/`.
