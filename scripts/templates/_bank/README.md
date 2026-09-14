# Bank recipes

Ten v3 recipe payloads written 2026-09-08 from
[`docs/architecture/grand-simulation/open-bank-reference.md`](../../../docs/architecture/grand-simulation/open-bank-reference.md)
§8.4, the digest of `JiRaska/open-bank-oss` read as a requirements corpus.

**What they are.** Craft, not configuration and not a runbook. Each one is the mastery behind one
obligation an enterprise-grade service has to carry, written so any role in any project can adopt
it: reading a service against a declared contract, turning a recurring defect into a check that can
be shown to fail, mapping a regulation to controls and artefacts, modelling a money path, stating a
load envelope and reporting the machine's ceiling beside the result, probing the rejection path,
declaring a service's data and lineage, keeping three version axes in agreement, splitting a
decision's status from its delivery, and auditing declarations against code.

**What they are not.** They are not banking domain knowledge. Nothing here teaches double-entry
accounting, a payment scheme or a credit decision; the registry still owes a `banking` knowledge
bundle for that (`grand-simulation.md` §3, G9). What the reference gave was the *machinery* a
regulated build carries, and the machinery is what these ten encode.

**Owner.** `bank`. They are project-bound craft, reached for by an App Master or by a hired role,
and are deliberately not tied to any one of the simulation's six projects.

| Slug | Domain | The obligation behind it |
|---|---|---|
| `money-path-service-certification` | software_engineering | the per-service contract in the digest's §4 table, gate by gate |
| `gate-authorship-from-a-recurring-defect` | software_engineering | `gate-subject-floor`, `gate-selftest-declaration`, and "a gate that has only ever passed is unfalsified" |
| `regulatory-acceptance-mapping` | legal_compliance | the evidence pack's shape: one table, one artefact path per requirement, a named gap where none exists |
| `threat-model-for-a-money-path` | software_engineering | ADR-0030 D2 and `threat-model-updated-on-trust-boundary-change` |
| `load-envelope-authorship` | software_engineering | "a route that did not answer 200 invalidates the percentile" |
| `abuse-path-smoke` | software_engineering | the `security-abuse-smoke` lane, where a 200 or a 5xx on a probe is a finding rather than a pass |
| `service-self-declaration-and-lineage` | data_ai | ADR-0071 and `lineage-code-audit`, every declared edge backed by code or allowlisted |
| `contract-first-api-stewardship` | software_engineering | ADR-0048's three axes and `openapi-route-conformance` |
| `adr-authorship-with-split-status` | software_engineering | decision status separate from delivery status, so accepted never implies built |
| `governance-drift-audit` | software_engineering | "Agents propose; governance disposes", and `agent-review-proof-falsifiable` |

Every payload cites the gate id or the ADR number its obligation comes from, in its examples and
where it reads naturally in its description. None of those ids was invented; each is quoted from the
digest, which in turn cites the file it came from.

**Two pairs overlap `../_app_master/` on purpose, split by altitude.**
`money-path-service-certification` and `gate-authorship-from-a-recurring-defect` are the craft;
`_app_master/service-contract-stewardship` and `_app_master/gate-authorship` are the standing
responsibility that reaches for it. The first pair reads one service and writes one check
declaration; the second pair owns a wave across every service and carries a rule to the manifest's
owner. Likewise `threat-model-for-a-money-path` is how one model is authored and reopened, while
`_app_master/threat-and-evidence` is custody of all of them across a project.

All ten are `status: "draft"` with no `version`, per [`../_RECIPE_V3_SPEC.md`](../_RECIPE_V3_SPEC.md).

**Merging.** They become seed rows in `_recipe_seeds.json` owned by the virtual template `bank` (no
template file exists: like the Architect and App Master payloads they are adopted headlessly, never
through a preset). The merge is the App Master's own script, pointed at this directory:

```bash
node scripts/templates/_app_master/merge-into-bundle.mjs --dir scripts/templates/_bank --owner bank
node scripts/templates/generate-recipe-index.mjs
```

Both are idempotent, keyed by recipe `id`, so re-running after an edit replaces rather than
duplicates. `--check` on the second is the `npm run check:recipe-index` gate, and
`node --test scripts/templates/merge-into-bundle.test.mjs` pins the flags. Re-run the pair after
editing any payload here.

The merge derives each row's `category` from the payload's own `domain`, which is why
`regulatory-acceptance-mapping` files under `operations` and `service-self-declaration-and-lineage`
under `analytics` while the other eight file under `development`. That derivation lives once, in
`../_domain-categories.mjs`, and is read by both the merge and the index generator.

**Bundle: 116 recipes before 2026-09-08, 130 after** (these ten plus the four new App Master
payloads).
