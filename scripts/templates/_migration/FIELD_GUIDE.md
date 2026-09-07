# Field guide: migrating the recipe corpus into the ai-registry

**Read this fully before touching a recipe.** Ten agents work this migration in parallel,
one lane each, and this file is the only thing that makes their output one corpus instead
of ten. `notes/` is the other half: what you learn, the other nine read.

---

## 1. What this migration is

The Personas application holds 111 Recipe v3 objects in one bundle
(`scripts/templates/_recipe_seeds.json`). They were transformed into v3 shape on
2026-09-06 and every one of them is `status: draft` with no version: a **starting line**,
not a library. They have never been researched against the outside world.

This migration moves 105 of them into the organization's registry at
`C:/Users/kazda/kiro/ai-registry/recipes/`, and the move is **not a copy**. A recipe
leaves here as draft knowledge and arrives there as `seed` knowledge at version `0.1.0`,
because on the way it is **enriched**: researched against current practice, sharpened
against what the running system has actually taught, and given the use cases that let
somebody find it in a corpus of two hundred.

The mechanical half of that move is automated (`rx.mjs`). The half that makes a recipe
worth finding is your job.

### The two layers, and the line between them

| | Recipe (what you are writing) | Charter (an adopted instance, in the app) |
|---|---|---|
| owns | need, input, core action, output, activities, outcomes, guidance, use cases, connector TYPES, recommended trigger, personalization needs, dependencies, examples | bound connectors, assigned trigger and cadence, credentials, budget, scope, approval gates, persona memory |
| never carries | a connector id, a cron, a persona, a credential, a file path | a lesson somebody in another organization would want |

If a sentence you are about to write names a specific connector, a schedule, an account or
a person, it belongs in `examples/` at best and in the consuming app at worst. Never in
the recipe body.

### Six recipes are deliberately NOT in scope

`codebase-architecture-review`, `codebase-security-scan`, `codebase-static-analysis-sweep`,
`technical-decision-capture`, `accepted-idea-delivery`, `project-kpi-stewardship`.

These are the App Master's responsibilities and they are under live end-to-end test right
now (`docs/architecture/app-master-e2e.md`). Their shape is still moving, and freezing a
moving shape into a versioned registry artifact is how a registry starts lying. They
migrate after those cycles settle. **Do not scaffold them.** `LANES.json` already excludes
them; if you find one in your lane, that is a bug worth a note.

---

## 2. The pipeline, per recipe

Work one recipe at a time, all the way through, then the next. A half-migrated lane is
worse than a short one.

```bash
# 0. read what exists today
node scripts/templates/_migration/rx.mjs show <slug>

# 1. create the registry directory, converted and rendered, use_cases empty
node scripts/templates/_migration/rx.mjs scaffold <slug>

# 2. RESEARCH (below), then EDIT recipe.json in the registry, then:
node scripts/templates/_migration/rx.mjs render <slug>      # re-render RECIPE.md

# 3. the gate, which is the definition of done
node /c/Users/kazda/kiro/ai-registry/scripts/check-recipes.mjs
```

`recipe.json` is **authored**; `RECIPE.md` is **generated**. Never hand-edit the rendered
view: the gate compares five frontmatter keys against the JSON and a hand edit fails it
later for a reason nobody remembers. Edit JSON, run `render`.

### Definition of done, per recipe

- `recipe.json` carries `use_cases` (3 to 6) and every field the gate requires.
- The four description fields and the guidance reflect what your research learned, not
  what the draft said, wherever the two differ.
- `examples/<connector>.md` exists for every entry in `examples[]` and carries real
  mapping knowledge, not a restatement of the recipe.
- `RECIPE.md` re-rendered after the last JSON edit.
- `check-recipes.mjs` is green over the whole lane (yours and everyone else's).
- A note in `notes/<your-lane>.md` if you learned anything the other nine could use.

---

## 3. What enrichment means

Three inputs, in this order. All three are real work; none is optional.

### 3a. Web research

For each recipe, ask: **what does somebody who is genuinely good at this work know that
this draft does not say?** Search for current practice, named methods, the failure modes
practitioners write about, the numbers that matter. You have `WebSearch` and `WebFetch`.

Two or three focused searches per recipe is the right order of magnitude. Signals worth
carrying back:

- A **named method or standard** the work should be anchored to (an SLO burn-rate rule, a
  dunning cadence, a retention curve, an accessibility level, a filing deadline). Anchor
  the judgment to it in `guidance`, without turning guidance into a citation list.
- A **failure mode practitioners keep hitting**. These are the best `outcomes` and the best
  `guidance` sentences, because they are what separates mastery from a description.
- A **quantity** that decides something (how long engagement takes to settle, what
  fraction of tickets a category has to reach before it is a pattern). Put it where it
  decides something, not as trivia.
- What the work looks like when it is done **badly but plausibly**. This is usually the
  sharpest `need` sentence available.

Do **not** paste sources into the recipe. The recipe carries the knowledge, not the
bibliography. Put the source in your lane note instead, so the other nine can reuse it.

### 3b. What the running system taught

The App Master arc ran a live autonomous loop over three real projects on 2026-09-07 and
produced lessons that generalize past its own six recipes. Apply the ones that touch your
recipe; ignore the rest. Full record: `docs/architecture/app-master-e2e.md`.

- **A result that is not written down did not happen.** Workers delivered real commits and
  the system could not tell a finished item from an untouched one, because nothing wrote
  the outcome back. If your recipe hands work off, produces a finding, or takes a
  measurement, the `deliver` activity and at least one outcome must name **the durable
  record**, not just the artifact.
- **Declaring the meter is the work; describing it is not.** Stewards wrote KPI proposals
  into documents instead of declaring the KPI where it could be measured. An outcome that
  says "X is measured" is not met by prose about X.
- **A reading taken in one environment is not a claim about another.** A local probe and a
  production reading are different claims and conflating them silently corrupts a trend.
- **Re-validate the premise before doing the work.** Two queued items were acted on whose
  premise the code had already overtaken; the work that was actually needed was underneath.
  A recipe that acts on a queued item, a ticket, an alert or an accepted idea should carry
  an explicit re-validation step **with the authority to decline and say why**.
- **"In flight" needs an observable end.** Work was deferred as in-flight twenty-five
  minutes after it finished, because nothing carried completion back. If your recipe hands
  off, say how completion is observed.
- **Recording a zero is the work.** "Looked and found nothing" is a result that stops the
  next run paying for the same look. Most contexts deserve no KPI, most scans find nothing,
  and a recipe that only knows how to report findings will re-scan forever.
- **A first run establishes a baseline and says so.** Reporting a delta against nothing is
  the most common way a monitoring recipe lies on day one.

### 3c. Your own judgment

You are reading a draft that was written by transformation, not by a practitioner. Where it
is vague, sharpen it. Where its `activities` do not match the work as you now understand
it, change them. Where an outcome is not checkable, make it checkable. This is a rewrite
with a strong starting point, not a formatting pass.

**The one thing you may not do is invent experience.** `LESSONS.md` stays empty: a lesson
records a run, and no run has happened. `status` stays `seed` and `version` stays `0.1.0`
for every recipe in this migration.

---

## 4. `use_cases`: the field this migration adds

Three to six, required, gate-enforced. This is the **selection signal**: `need` and
`core_action` describe the craft, `use_cases` describe the situations that should reach for
it, and they are not the same sentence. A corpus of two hundred recipes is selected FROM.

Each entry names **a situation and why the work pays there**: who is in it, what is going
wrong or about to, what this recipe changes about that.

- Good: *"A team publishing several times a week across more than one platform, where the
  numbers get read aloud in a meeting and the loudest post wins the argument whether or not
  it beat its own history."*
- Bad: *"Marketing teams."* An audience is not a use case. Every recipe in the domain would
  claim it, so it selects nothing.

Write them **last**, after the description and guidance are final, so they describe the
recipe that exists rather than the one that was planned. Vary them: a solo operator, a
team, a scaling moment, a moment of pressure. If all four of yours describe the same
person on the same day, you have written one use case four times.

---

## 5. Field mapping and the traps in it

`rx.mjs scaffold` does the mechanical conversion, so you should never do it by hand. It is
listed here so you can recognise a bad conversion when you see one.

| Personas bundle (camelCase) | Registry lane (snake_case) |
|---|---|
| `description.coreAction` | `description.core_action` |
| `outcomes[].successCriteria` | `outcomes[].success_criteria` |
| `connectorTypes` | `connector_types` |
| `recommendedTrigger` | `recommended_trigger` |
| `personalizationNeeds` | `personalization_needs` |
| `inputSchema` | `input_schema` |
| `examples[].connectorType` | `examples[].connector_type` |
| `provenance.fromRecipes` / `fromTemplates` / `sourceTemplateId` | `from_recipes` / `from_templates` / `source_template_id` |
| `status: "draft"`, no `version` | `status: "seed"`, `version: "0.1.0"` |

**Traps that will cost you a gate failure:**

- **Em and en dashes fail the gate** over every string in the object, including ones you
  copied from a web page. Rewrite the sentence; do not swap the character for a hyphen and
  leave the em-dash grammar behind.
- **`desktop` is a forbidden connector type.** Every agent has desktop access, so it binds
  to nothing. If the draft carries it, drop it and say so in your note.
- **`slug` must equal its directory, `domain` its top folder, `path` `<domain>/<topic>`.**
  Do not move a recipe between topics without checking the ten-directory cap per level
  (`recipes/` itself is at exactly ten domains: adding an eleventh fails the gate for
  everyone, so if you believe a recipe needs a new domain, write a note and leave it).
- **Guidance is 40 to 90 words** and numbered steps in it are reported. Guidance is
  judgment; the sequence is `activities`.
- **Activities are 3 to 8, linear, branch-free**, kinds `observe` / `decide` / `act` /
  `deliver`, ids unique and kebab-case. No conditions, no edges. If it needs a branch it is
  a runbook and does not belong in a recipe.
- **An `examples[]` entry naming a connector with no `examples/<connector>.md` beside it**
  is reported as a note. Either write the file or drop the entry. A file that just restates
  the recipe is worse than no file: an example is what you learn mapping the recipe onto
  **that one** connector, and it must stop applying when you swap the connector.

### House voice

The corpus is written in one voice and it is worth matching. No em dashes. No marketing
language. No "leverage", no "seamlessly", no "best-in-class". A `need` is a claim about
what goes wrong without the work, written so a practitioner nods. An `outcome` is a claim
about the world, not about the agent's activity. Read
`recipes/sales_marketing/web-analytics/web-analytics-performance-review/` in the registry
before you write your first one: it is the worked example and the quality bar.

---

## 6. Working alongside nine others

- **Your lane is yours.** `LANES.json` assigns every slug exactly once. Do not touch a
  recipe outside your lane, even to fix something. Write a note instead.
- **The registry is a shared checkout with no locking.** You only ever create files under
  `recipes/<domain>/<topic>/<slug>/` for slugs in your lane, so you cannot collide. Do not
  edit `docs/`, `scripts/`, `registry.yaml`, `index.json` or another lane's recipe: the
  schema and the gate are already extended for this migration and are not yours to change.
- **Do not commit.** Not in either repository. Everything is reviewed and committed once,
  by the director, when all 105 are in.
- **Do not run the index builder.** It runs once at the end.
- **Run the gate often.** It is fast and it checks the whole lane, so a green run also
  tells you nobody else has broken anything.

### The notes protocol

`scripts/templates/_migration/notes/<your-lane>.md` is yours to append to. Every other
lane's file is yours to read.

- **Before your first recipe:** `cat scripts/templates/_migration/notes/*.md`.
- **After every fourth recipe or so:** read them again. Nine agents are learning the same
  craft in parallel and the second half of your lane should be better than the first.
- **Append when you have something the other nine could use**, not as a log of what you
  did. Aim for three to eight entries over a lane, each one thing.

Format, so the files stay readable:

```markdown
## HH:MM - TAG - one-line title
- the thing itself, in one to four lines
```

Tags: `RESEARCH` (a source or finding others can reuse) · `PATTERN` (a way of writing
something that worked) · `TRAP` (something that cost you time) · `GATE` (a gate behaviour
worth knowing) · `DECISION` (a judgment call others should copy for consistency).

Notes worth writing look like: a research source that covers several recipes; a phrasing
pattern for `use_cases` that reads well; a gate message whose cause was not obvious; a
decision about how to treat a recurring shape (a recipe with no connectors, a recipe whose
draft trigger looks wrong, a draft whose `need` was plainly written by transformation).

Notes not worth writing: "migrated three recipes", "the gate passed", anything only true
of one recipe in your lane.
