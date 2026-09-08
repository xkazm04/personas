# Architect recipes

Five v3 recipe payloads for the **Architect**, the cross-project role of the Grand Simulation
(`docs/architecture/grand-simulation.md` §0.2, §2): it designs the enterprise solution, composes
the portfolio, plans the workforce, directs through goals and the channel, and reflects on scope.
The Architect binds to a **workspace**, never to one project, and never writes application code.

All five are `status: "draft"` with no `version`, per `scripts/templates/_RECIPE_V3_SPEC.md`.

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
