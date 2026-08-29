# Architecture

Cross-cutting implementation contracts and system diagrams live here.

| Document | Scope |
| --- | --- |
| [overview.md](overview.md) | Current high-level app architecture |
| [codebase-map.md](codebase-map.md) | Implemented feature roots, command surfaces, and documentation targets |
| [persona-matrix-build.md](persona-matrix-build.md) | Matrix build session and adoption state machine |
| [resource-scoping.md](resource-scoping.md) | Credential/resource scoping rules |
| [mcp-desktop-integration.md](mcp-desktop-integration.md) | MCP and desktop integration |
| [gitlab-integration.md](gitlab-integration.md) | GitLab integration architecture |
| [pattern-source-definition.md](pattern-source-definition.md) | Pattern/source definition contract |
| [memory-graph-and-storage-engine-assessment.md](memory-graph-and-storage-engine-assessment.md) | The retrieval lane roster, the two relation stores nothing queries, and why we are not adopting a graph engine |
| [relation-lane-experiment-plan.md](relation-lane-experiment-plan.md) | Deferred: how we would test whether a relation-traversal lane earns its seat, without assuming it does |
| [memory-vector-orphan-reconciliation.md](memory-vector-orphan-reconciliation.md) | Reaper registry, orphan ledger, and dependent-side sweep for the memory vector store (deferred-fixes #108) |
| [prune-preview-enforcement-path.md](prune-preview-enforcement-path.md) | Storage prune preview computed through the enforcement path (deferred-fixes #31) |
| [scene-store-race-guards-and-relay-bound.md](scene-store-race-guards-and-relay-bound.md) | Mastermind scene-store keyed race guards + browser-bridge relay channel bound |

Archived root architecture notes were moved to [_archive/root/ARCHITECTURE.md](../_archive/root/ARCHITECTURE.md).
