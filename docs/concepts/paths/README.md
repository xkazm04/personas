# This corpus has moved — edit it in the registry

**Authority: [`xkazm04/ai-registry`](https://github.com/xkazm04/ai-registry) → `knowledge/software-engineering/`.**

The 105 subjects / 624 techniques / 236 applications under this directory are a
**mirror**. They are still read — nothing is broken, and a project whose workspace
holds no registry still reads this tree — but new work does not land here.

## Where to make each kind of change

| You want to… | Do it |
| --- | --- |
| Forge a new subject | Registry pull request. Merging is adopting (`CODEOWNERS`). |
| Improve a technique or golden path | Registry pull request. |
| Add an application | Registry pull request. |
| Record **evidence** for a subject | **Here** — evidence is consumer-side and never publishes (`docs/rkb-profile.md` §5 in the registry). |
| Register a **deviation** | **Here** — `docs/concepts/golden-path-deferred-fixes.md`, same reason. |

The split is the point: the registry holds the **standard**, which has to transplant
to any codebase; this repo holds **how this codebase measures against it**, which is
meaningless anywhere else. That is why `evidence-check` and the census scorecard
stayed on this side while the layer contract, body purity and link resolution went
to the registry's CI.

## Why this tree still exists

Deleting it is **P4**, and it is gated on six checks that have not all passed yet —
see [`docs/concepts/knowledge-registry-migration.md`](../knowledge-registry-migration.md).
Until then this mirror is the fallback for any workspace not yet wired to a
registry, and `scripts/registry/mirror-paths.mjs` keeps it current in the one
direction that is safe (here → registry).

**Do not hand-edit these files.** An edit here is invisible to every other consumer
of the registry, and the next mirror run will not merge it — it will look like the
registry drifted from you when in fact you drifted from it.

## Reading it in the app

Overview → Patterns reads the wired registry's clone when the project's workspace
holds one, and this tree otherwise. The reader discovers either layout
(`docs/concepts/paths/` or `knowledge/<domain>/`) and reports which it used in
`source.corpusRel`, so the UI can always say where what you are looking at came from.
