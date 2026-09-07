# Architect recipes (drafts)

Five v3 recipe payloads for the **Architect**, the cross-project role of the Grand Simulation
(`docs/architecture/grand-simulation.md` §0.2, §2): it designs the enterprise solution, composes
the portfolio, plans the workforce, directs through goals and the channel, and reflects on scope.
The Architect binds to a **workspace**, never to one project, and never writes application code.

All five are `status: "draft"` with no `version`, per `scripts/templates/_RECIPE_V3_SPEC.md`.
They are **not merged into `_recipe_seeds.json`** and nothing here has been run.

**Merging.** `scripts/templates/_app_master/merge-into-bundle.mjs` reads its own directory only
(`HERE`) and stamps `OWNER = 'app-master'`, so it cannot merge this folder. The merge path is a
copy of that script placed here with `OWNER = 'architect'`. Do not run it without an operator
asking; after any merge, `node scripts/templates/generate-recipe-index.mjs`.
