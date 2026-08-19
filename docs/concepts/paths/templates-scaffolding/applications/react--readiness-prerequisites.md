---
layer: application
subject: templates-scaffolding
technique: readiness-prerequisites
stack: react
---

# Readiness prerequisites in the template adoption frontend

The technique's two render points and its matcher live in three files:
`vaultAdoptionMatcher.ts` (the matcher), `adoptionReadiness.ts` (the
browse-time score), and `useAdoptionDimensionModel.tsx` (the pre-commit
gate). The repo demonstrates both the standard done well and its "one
evaluator, two render points" rule bent.

## The matcher: block / auto-select / filter, decided per question

`src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts` —
`matchVaultToQuestions` (`:171-246`) walks the template's adoption questions
against the set of vault credential `service_type`s and produces four
outputs: `autoAnswers`, `autoDetectedIds`, `blockedQuestionIds`,
`filteredOptions`. The policy matrix is documented in place (`:139-169`)
and is a textbook three-way verdict:

- **0 matches, no fallback → block** (`:232-234`): the question lands in
  `blockedQuestionIds`, which lights the "credentials required" banner and
  the remedy path.
- **1 match, no fallback → auto-select and tag** (`:235-238`): the single
  satisfying credential is pre-answered and marked auto-detected — the
  adopter confirms rather than hunts.
- **2+ matches → narrow the option list to matched-only** (`:239-241`);
  with a null "Other/custom" fallback the list narrows to matched+Other and
  never blocks (`:223-231`), because the escape hatch is a legitimate
  answer.

The rationale comment at `:158-163` states the technique's core argument in
repo dialect: if the options are shown unfiltered, the credential
annotations on them are "pure decoration. Filtering is the whole point."

Two details are transplant-worthy:

- **Alias-aware matching** (`SERVICE_TYPE_ALIASES`, `:28-37`): the same
  logical provider is stored under different `service_type` spellings
  depending on which creator path minted the credential (catalog UI, CLI
  probe, foraging, healthcheck — enumerated at `:17-26`). This is a
  one-authority-per-vocabulary violation upstream (four writers, four
  spellings), compensated at the single point of consumption. The comment
  even names the maintenance contract: "add to this map whenever a new
  creator path introduces a different spelling."
- **Capability-level matching** (`hasMatchingCredential`, `:56-67`): a
  template asking for the *category* `image_generation` is satisfied by any
  credential whose connector carries that category tag — match on role,
  not name, exactly as the technique prescribes.

`deriveCredentialBindings` (`:99-137`) is the adoption-time resolution the
matcher's verdict promises: answers become a `category → service_type`
binding map so the backend rewrites placeholder connectors (`name:
"email"`) to the adopter's concrete pick (`"gmail"`) — the portability
role→binding handshake, executed at the commit.

## The pre-commit gate

`useAdoptionDimensionModel.tsx` consumes `blockedQuestionIds` and computes
`globalBlocked` / `globalRemaining` over the gated (non-optional,
non-disabled) questions (`:281-294`); `canContinue` requires both to be
zero. The center overlay (`:422-453`) renders the *named* refusal — a
count of blocked questions or remaining answers, with `openFirstUnanswered`
jumping the adopter straight to the first gap — and `onAddCredential` is
threaded into the answer card as the remedy affordance. Optional questions
never block (`vaultAdoptionMatcher.ts:194-197`), matching the technique's
degraded-adoption stance: nice-to-have connectors don't hold the commit
hostage.

## The browse-time score — and the two-evaluator deviation

`adoptionReadiness.ts` computes a 0–100 readiness score per gallery card
from the template's declared `suggested_connectors[].category` list
(optional ones skipped, `:25`), matched at *category* level so "any email
client unlocks all email-dependent templates." `readinessTier` (`:74-78`)
maps it to Ready / Partial / Setup-needed badges.

This is the technique's advisory browse-time render — but it is **not the
same evaluator as the gate**. The score reasons over
`suggested_connectors` categories; the gate reasons over per-question
`option_service_types` and `dynamic_source` declarations. Two
approximations of the same fact can disagree: a card can read "Ready"
while a question still blocks (a question-level service type with no
category representation), or "Setup needed" while every gating question
has a null-fallback escape. The standard's posture — one evaluator, two
render points — would derive the badge from `matchVaultToQuestions` run in
summary mode. Below-standard details in the same file: `readinessTier`
hardcodes English labels (`'Ready'`, `'Partial'`, `'Setup needed'`) in a
codebase whose i18n rule bans exactly that, and returns raw
`emerald`/`amber` utility classes rather than semantic tokens.

## What the seed path proves

The built-in catalog is seeded with defaults applied and no interview —
the most automated pass through this machinery. It is why the matcher
treats a question with declared credential options but no vault match as
*blocked* rather than silently answered: an unattended answer to an
unsatisfiable question is precisely the born-broken instance the technique
exists to prevent.
