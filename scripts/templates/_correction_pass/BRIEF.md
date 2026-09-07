# The correction-signal pass

Ten agents, one lane each, 88 recipes. This brief is the whole contract; read it fully.

## Where this came from

The first `/assay` run mined gbrain and its most valuable finding was not about gbrain. It
was that **gbrain treats a human correction as a first-class signal in three separate
places** (it root-causes a correction to the store that produced it; it mines corrections
as the gold signal when building an eval from real usage; its whole design assumes the
operator corrects the machine and the machine changes) while **88 of our 109 recipes never
mention one at all.**

## The failure mode this brief exists to prevent

The wrong reading of that finding is "add a correction sentence to 88 recipes". That would
produce 88 interchangeable sentences, which is padding, and padding is worse than the gap
because it looks like the gap was closed. **You are not applying a template. You are asking
a question, recipe by recipe, and acting only where the answer is yes.**

## The question, asked of every recipe in your lane

> **Does this work produce a judgment a human can overrule, and does it run more than once?**

Both halves matter.

- **A judgment a human overrules** means the recipe ranks, scores, filters, proposes,
  drafts, classifies, flags or decides what reaches a person. If it only moves data, or
  only reports a number it measured, there is nothing to correct.
- **Runs more than once** means the next run exists and could be different. A one-shot
  derivation has nowhere to put what it learned.

**If either answer is no, leave the recipe alone and say so in your report.** That is a
correct outcome and I expect a real number of them. A recipe that files a contract's
deadlines is not improved by pretending somebody corrects its arithmetic.

## Where the answer is yes

The enrichment names three things, all specific to **this** recipe's judgment:

1. **What gets corrected.** Not "the output". The particular call this recipe makes: which
   item it ranked first, which one it suppressed, which class it assigned, which draft it
   proposed.
2. **Where the correction lands.** Somewhere the next run reads. If the recipe already has
   a durable record (a ledger, a stored baseline, a rubric, a per-item verdict), the
   correction belongs with it and you say so. If it has none, saying that the correction
   needs a home is itself the finding.
3. **What the next run does differently.** This is the half that makes it craft rather than
   bookkeeping. A correction that changes nothing is a complaint.

**Test your own work before you finish:** read your lane's enrichments side by side. If two
of them could be swapped between recipes without either looking wrong, you have written a
template and both are padding. Rewrite or drop them.

## The mechanics

Per recipe, in this order:

```
cd C:/Users/kazda/kiro/ai-registry
#   edit recipes/<domain>/<topic>/<slug>/recipe.json      <- the authored artifact
node ../personas/scripts/templates/_migration/rx.mjs render <slug>
node scripts/check-recipes.mjs
```

- **One field.** Usually one `success_criteria` entry under an existing outcome, sometimes
  `guidance`, occasionally an `activity` label or a `personalization_need`. Do not
  restructure a recipe that is already good.
- **Guidance is 40 to 90 words and 36 of these 88 are already at 85 or more.** If guidance
  is the right home and it is full, something must come out, and what comes out must
  already be said elsewhere in the recipe (an outcome, a criterion) or be genuinely weaker
  than what replaces it. When nothing is weak enough to evict, **use a success criterion
  instead** and say why in your report. That is the better answer more often than not.
- **Version bump: minor** (`0.x.0` to `0.(x+1).0`) because this is a change to the craft.
  A recipe already at `0.2.0` from the assay run goes to `0.3.0`.
- `RECIPE.md` is generated. Never hand-edit it; `render` after every JSON edit.

## House rules

No em or en dashes anywhere, over every string, or the gate fails. Guidance is judgment and
never numbered steps. Outcomes are claims about the world, not about the agent's activity.
Never name a connector, a product, a cron or a person in a recipe body. Do not touch
`LESSONS.md`: a lesson records a run, and no run has happened. Do not commit. Do not touch a
recipe outside your lane. Do not run the index builder.

## The gate is shared and you are not alone in it

Ten of you are writing into one checkout. `check-recipes.mjs` walks every recipe including a
sibling's half-rendered one, so a red line mid-run usually belongs to somebody else and
clears on its own. **Verify by absence:** grep the gate output for your own slugs, and if
they appear in neither the problems nor the notes, yours are clean.

## Notes

`notes/<your-lane>.md` is yours to append to; every other lane's is yours to read. Read them
all before you start and again halfway. Write an entry when the other nine could use it,
especially: **a class of recipe where the answer is reliably no** (that saves nine agents
the same deliberation), a phrasing that carried the three parts without bloating, or a
recipe whose durable record turned out not to exist.

Format: `## HH:MM - TAG - one line`, then bullets. Tags `PATTERN`, `TRAP`, `DECISION`, `NO`.
