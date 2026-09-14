# App Master recipes

Six v3 recipe payloads for the **App Master**, the per-project owner of the Grand Simulation
(`docs/architecture/grand-simulation.md` §2): it delivers accepted ideas, stewards the project's
KPIs, certifies its services against the contract the project declared, answers a recurring defect
with a check rather than a note, holds the threat models and the evidence on a money path project,
and certifies acceptance through the project's representative users. An App Master binds to **one
project**, never to a workspace; the cross-project role is the Architect (`../_architect/`).

All six are `status: "draft"` with no `version`, per `../_RECIPE_V3_SPEC.md`.

| Slug | What it holds |
|---|---|
| `accepted-idea-delivery` | one accepted item carried to a reviewable, verified change on the main branch |
| `project-kpi-stewardship` | the project's KPIs, measured rather than asserted |
| `service-contract-stewardship` | before every merge wave, every service read against the contract the project declared, gaps filed as items |
| `gate-authorship` | a defect that has now happened twice answered with a check in the shared manifest, proposed to its owner and then tended |
| `threat-and-evidence` | **money path projects only**: a current threat model per money path service, moved in the same change that moves a trust boundary, plus one evidence row per obligation with a named gap where no artefact exists |
| `acceptance-certification` | the project's journeys certified through its representative users, theoretical after every merged wave and empirical once per act, findings filed as items |

The last four were added 2026-09-08 from `docs/architecture/grand-simulation/open-bank-reference.md`
§8.3, and each is grounded in a named obligation from that digest: the per-service contract in its
§4 table, the gate manifest's self-test rule in §5, ADR-0030 D2 and the gates
`threat-model-coverage` / `threat-model-updated-on-trust-boundary-change` /
`threat-model-claims-resolve` in §4, and the load baselines' rule in §7.1 that a route which did not
answer 200 invalidates the percentile.

**Two pairs are deliberately close, and the split is by altitude, not by subject.**
`service-contract-stewardship` and `gate-authorship` are what the App Master *holds*: the wave gate
across every service it owns, and the ownership of a rule from recurrence through proposal to
review date. `_bank/money-path-service-certification` and `_bank/gate-authorship-from-a-recurring-defect`
are the *craft* underneath them: reading one service obligation by obligation, and writing one
check declaration that can be shown to fail. An App Master holds the first pair and reaches for the
second.

**Merging.** These are seed rows in `_recipe_seeds.json` owned by the virtual template `app-master`
(no template file exists: they are adopted headlessly through the App Master door, never through a
preset). The merge is this directory's own script, which takes the directory and the owner as flags
so a second copy of it never has to exist:

```bash
node scripts/templates/_app_master/merge-into-bundle.mjs --dir scripts/templates/_app_master --owner app-master
node scripts/templates/generate-recipe-index.mjs
```

With no flags the script defaults to this directory and this owner, which is the same merge. Both
commands are idempotent by recipe `id`, and `--check` on the second is the `npm run check:recipe-index`
gate. Re-run the pair after editing any payload here; the flags are pinned by
`scripts/templates/merge-into-bundle.test.mjs` (`node --test`), whose first case asserts that the
default merge adds nothing and replaces every payload in this directory in place. That assertion
counts the files here rather than a hardcoded number, so adding a seventh recipe does not break it.

**Bundle after this directory's merge: 130 recipes** (116 before the 2026-09-08 additions, plus 4
here and 10 in `../_bank/`).
