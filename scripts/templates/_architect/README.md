# Architect recipes

Five v3 recipe payloads for the **Architect**, the cross-project role of the Grand Simulation
(`docs/architecture/grand-simulation.md` §0.2, §2): it designs the enterprise solution, composes
the portfolio, plans the workforce, directs through goals and the channel, and reflects on scope.
The Architect binds to a **workspace**, never to one project, and never writes application code.

All five are `status: "draft"` with no `version`, per `scripts/templates/_RECIPE_V3_SPEC.md`.

| Slug | What it decides |
|---|---|
| `enterprise-solution-design` | where the seams fall, named against an external ontology, with the value path designated and the standards carried from the first revision |
| `project-portfolio-composition` | the design turned into projects, each with a repository, a self declaration, an owner and first goals |
| `goal-direction-and-authority` | goals traceable to the design, and direction spoken in a stated register with a criterion rather than a wish |
| `workforce-planning` | which roles are actually missing, described as work, evidence, acceptance and a privilege boundary |
| `scope-reflection` | what each proposal from the workers changes: a charter, the design, a gate, or nothing |

**Amended 2026-09-08** against `docs/architecture/grand-simulation/open-bank-reference.md` §8.2.
All five were still drafts, so these are edits to drafts rather than to shipped recipes:

- `enterprise-solution-design` gains a named external ontology term per context, an explicit value
  path designation with the stricter obligations it triggers, and the standards the domain is
  subject to as an input rather than something acquired in Act 5.
- `project-portfolio-composition` gains a per-project self declaration and a `declare` activity
  between `create` and `staff`, because a portfolio only a person can read drifts the first week
  nobody rereads it.
- `goal-direction-and-authority` gains the rule that a directive names an acceptance criterion drawn
  from a standard rather than an outcome, phrased as requirement, control and evidence.
- `workforce-planning` gains the tool allow and deny list and the acts that always require a person,
  because a role's privilege boundary is part of its specification and not a deployment detail.
- `scope-reflection` gains **a gate** as a fourth classification outcome, which the digest calls the
  single highest-leverage edit in its section: a lesson that generalises and can be checked
  mechanically should refuse the mistake rather than describe it.

**Sibling directories.** `../_app_master/` holds the six per-project App Master recipes (four added
2026-09-08 from the digest's §8.3), and `../_bank/` holds the ten craft recipes from its §8.4. The
Architect recipes stay workspace-bound; those two are project-bound.

**Merging.** They are now IN `_recipe_seeds.json`, as seed rows owned by the virtual template
`architect` (no template file exists: these are adopted headlessly through
`POST /dev-tools/architect/adopt`, never through a preset). The merge is the App Master's own
script, generalised over its directory and owner rather than copied:

```bash
node scripts/templates/_app_master/merge-into-bundle.mjs --dir scripts/templates/_architect --owner architect
node scripts/templates/generate-recipe-index.mjs
```

Both are idempotent, and `--check` on the second is the `npm run check:recipe-index` gate. Re-run
the pair after editing any payload here; the flags are pinned by
`scripts/templates/merge-into-bundle.test.mjs` (`node --test`).

The earlier note here said the merge path was "a copy of that script placed here with
`OWNER = 'architect'`". It is not, and a second copy of a merge that has to stay in step with the
bundle's format contract is the thing the flags exist to avoid.

**Bundle total after all three directories are merged: 130 recipes** (116 before 2026-09-08, plus
the four new App Master payloads and the ten bank payloads; the five here were already in the
count and are replaced in place by their re-merge).
