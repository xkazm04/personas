# Personas Documentation

This directory is the source of truth for the current Personas Desktop product, its implementation contracts, and future proposals.

## Where to start

| Need | Start here |
| --- | --- |
| Current product behavior | [features/](features/README.md) |
| System architecture | [architecture/](architecture/README.md) |
| Codebase feature map | [architecture/codebase-map.md](architecture/codebase-map.md) |
| Local development, build, test, release | [development/](development/README.md) |
| Operations and troubleshooting | [operations/](operations/README.md) |
| Test plans and harness notes | [tests/](tests/README.md) |
| Future proposals only | [concepts/](concepts/README.md) |
| Historical handoffs and superseded docs | [_archive/](_archive/README.md) |

## Documentation rules

- `docs/features` describes what is implemented in the current app.
- `docs/concepts` is only for not-yet-implemented proposals and design explorations.
- `docs/architecture` documents cross-cutting implementation contracts and backend/frontend boundaries.
- `docs/development` documents how to build, test, debug, and contribute.
- `docs/harness` keeps dated product-review and code-review runs. Those are evidence, not source-of-truth feature docs.
- `docs/_archive` keeps moved or superseded material so old context is not lost.

When a concept ships, move or rewrite it under `docs/features` or `docs/architecture`, then leave only future follow-up work in `docs/concepts`.
