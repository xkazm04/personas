# Evidence home

The consumer-side layer of the knowledge registry, kept where the code it cites lives.

A golden path published to `xkazm04/ai-registry` is the **standard**. How this codebase
measures against it is meaningless anywhere else, so it never publishes:

| key | meaning |
| --- | --- |
| `evidence` | files that witness the standard |
| `counter_evidence` | files that break it |
| `deviations` | anchors into [`golden-path-deferred-fixes.md`](../concepts/golden-path-deferred-fixes.md) |

One file per subject slug, `docs/evidence/<slug>.md`. Identity is the slug, not the
taxonomy path, which moves with the registry. The trailing `# comment` on each pointer is
kept: it is the teaching value.

## Authority

- **Edit here.** This directory is the tracked archive. The registry clone's gitignored
  `.evidence.local.md` sidecars are a local convenience, never the archive.
- While the frozen `docs/concepts/paths/` mirror still exists, `node scripts/registry/extract-evidence.mjs --check`
  (run by `npm run check:evidence`) fails if the two disagree by value. Once `paths/` is
  deleted (migration P4) that comparison is skipped and this directory is the only copy.
- `npm run check:evidence` resolves every pointer against this tree, case-exactly, and
  compares the subject list with the registry clone.

## Commands

```sh
node scripts/registry/extract-evidence.mjs           # write missing files from paths/, refuse to overwrite a differing one
node scripts/registry/extract-evidence.mjs --check   # no writes; exit 1 on drift
npm run check:evidence                               # resolve pointers, compare with the registry
```

Readers: `scripts/registry/evidence-check.mjs`, `scripts/census/check-corpus-integrity.mjs`,
`scripts/census/build-paths-index.mjs` (subject-index, law-index, router). The Overview ->
Patterns UI still reads evidence from the corpus frontmatter through `hierarchy_read.rs`;
re-pointing it here is a P4 prerequisite.
