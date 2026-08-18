---
layer: technique
subject: web-scraping
technique: llm-assisted-rule-authoring
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# LLM-assisted rule authoring

Rule authoring is the scraping task a language model is genuinely good at:
reading a page's markup and proposing which selectors, patterns, or pointers
yield which fields. It is tedious-but-shallow work with a mechanically
checkable output — the ideal delegation shape. The technique is the set of
constraints that keep the delegation honest, because an unconstrained model
will happily author rules for a page it has never seen.

## The model authors rules; it does not extract

Two architectures compete here, and the choice is foundational:

- **Model-as-author** (this technique): the model runs at *authoring time*,
  once per page shape, producing rules that then execute deterministically
  on every harvest.
- **Model-as-extractor**: the model runs at *harvest time*, reading each
  page and emitting records directly.

Model-as-author wins for repeated extraction on every axis that matters:
cost (one model call per shape change, not per page per run), determinism
(the same page yields the same record), auditability (a human can read the
rules; nobody can read the model's nightly judgment), and failure honesty (a
rule that misses is a detectable event; a model that quietly guesses is
not). Model-as-extractor is defensible only where page shapes are too
heterogeneous for rules to exist — and even then it belongs behind the same
validation and preview gates, with its outputs treated as
[structured-output](../../structured-output/structured-output.md) hardening
demands. The failure smell is using harvest-time model calls on a *stable*
shape because authoring rules felt like work: paying inference per page,
forever, to avoid one authoring session.

## Grounded in the real page — never from imagination

The model's input is the **actual fetched markup of the actual target
page** — the same bytes the harvest engine would see. Never a description of
the page, never the model's training-data memory of "what listing sites look
like". A model asked to write rules from imagination produces plausible
selectors for a page that does not exist; they compile, they validate, and
they match nothing — or worse, match something wrong.

Practicalities of grounding:

- Pages routinely exceed comfortable model context. Reduce **losslessly with
  respect to structure**: strip scripts, styling, comments, and repeated
  boilerplate; truncate deep repetition (keep a few exemplars of a repeating
  item, note the count) — but the exemplars are verbatim page content, and
  anything the reducer dropped must be droppable *because rules will never
  target it*. Preserve any embedded data island intact; it is the model's
  best material (and yours — see the locator-kind
  priority in [extraction-rule-dsl](extraction-rule-dsl.md)).
- The fetch used for authoring is the fetch the pipeline would make — same
  client posture, same rendering decision. Authoring against a page fetched
  one way and harvesting it another is a gate that saw the wrong target.
- Stamp the proposal with **which fetch** it was authored against (address,
  time, content digest), so a later dispute — "these rules never worked" vs
  "the page changed Tuesday" — has an arbiter.

## Verified before save — the model's output is a claim, not a result

Proposed rules are **executed against the very page they were authored
from** before anyone can accept them. This is the gate-sees-target law in
its purest form: the claim is "these rules extract these fields from this
page", and the gate runs exactly that experiment. A proposed rule that
misses on its own authoring page is rejected mechanically — no human
review needed to discard it, and no amount of model confidence overrides
the miss.

Show the human the verification, not the rules alone: per rule, what
matched and a sample of the extracted value. Reviewing a selector string
requires markup literacy; reviewing "`title` → 'Vintage oak desk, £120'"
requires only knowing the page. That is the review the rule owner can
actually perform, and the [dry-run-preview](dry-run-preview.md) machinery
already renders it — the authoring loop reuses the preview, it does not
grow a private one.

Model-generated rules also pass the same **validation door** as
hand-authored ones (schema fields, locator syntax, declared failure
semantics). Generation is a rule *writer*, not a trusted channel.

## Replace vs merge — an explicit, informed choice

The dangerous moment is adoption. The target rule set may hold hours of
hand-tuning — fallback chains, hard-won patterns, deliberate failure
semantics. A model proposal that silently overwrites it converts assistance
into destruction. So adoption is a choice the human makes per proposal,
with the consequences displayed:

- **Replace** — the proposal becomes the rule set. Right for first authoring
  and for post-redesign recovery, where the old rules are dead anyway.
- **Merge** — field-by-field: proposed rules fill fields that have none,
  and collisions (field has a rule, proposal has a rule) are resolved
  per-field by the human, with both candidates' verification results side
  by side. Right for extending a working set to new fields.

Default to the non-destructive option; make "replace" a deliberate act.
And mark provenance on every adopted rule — machine-authored,
when, from which proposal — so a future maintainer knows which rules a
human has actually vetted versus accepted wholesale on a green preview.

## The redesign loop

This technique is not only for day one. When
[shape-change-detection](shape-change-detection.md) declares extraction
collapse, the recovery path is precisely this loop pointed at the *new*
page: fetch fresh, generate against the new shape, verify, and adopt with
"replace". A scraper with model-assisted authoring wired in turns a
redesign from an engineering interruption into a review task — which is the
economic argument for building this technique at all.
