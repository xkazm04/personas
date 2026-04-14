# Catalog loading, checksums, and caching

How template JSON files get from disk into the frontend catalog and
the SQLite seeded reviews. This is the layer that most commonly
surprises people — especially in dev mode when edits don't seem to
flow through.

## The pipeline

```
 scripts/templates/**/*.json
         │
         │ import.meta.glob (build-time static)
         ▼
 moduleLoaders: Record<path, () => Promise<TemplateCatalogEntry>>
         │
         │ loadAndVerify() on first call
         ▼
 verified: VerifiedEntry[]  (checksum-validated)
         │
         │ getTemplateCatalog() — cached as _cached
         ▼
 TemplateCatalogEntry[] (in-memory)
         │
         │ seedTemplates.templateToReviewInput()
         ▼
 SeedReviewInput[] (stringified payload as design_result)
         │
         │ batchImportDesignReviews() IPC
         ▼
 SQLite persona_design_reviews
         │
         │ listDesignReviews() via SWR
         ▼
 Gallery UI
```

## Vite glob loading

`src/lib/personas/templates/templateCatalog.ts:24` uses
`import.meta.glob` to collect every template JSON:

```ts
const moduleLoaders = import.meta.glob<TemplateCatalogEntry>(
  [
    '../../../../scripts/templates/**/*.json',
    '!../../../../scripts/templates/_*/**',
  ],
  { import: 'default' },
);
```

This is a **build-time** static analysis. Vite scans the glob pattern
when it parses templateCatalog.ts and emits a `moduleLoaders` object
where each entry is a dynamic import function. The actual JSON parsing
doesn't happen until the loader is called.

Underscore-prefixed directories (e.g. `scripts/templates/_drafts/`)
are excluded so you can stash work-in-progress templates without
polluting the catalog.

## Verification (`loadAndVerify`)

`templateCatalog.ts:51`:

```ts
async function loadAndVerify(): Promise<VerifiedEntry[]> {
  const modules = await Promise.all(
    Object.entries(moduleLoaders).map(async ([modulePath, loader]) => {
      const template = await loader();
      return { modulePath, template };
    }),
  );

  const verified: VerifiedEntry[] = [];
  for (const { modulePath, template } of modules) {
    if (template.is_published === false) continue;

    const relPath = templatePathFromModulePath(modulePath);
    const expectedChecksum = TEMPLATE_CHECKSUMS[relPath];

    if (!expectedChecksum) {
      logger.warn('Missing checksum for built-in template, skipping');
      continue;
    }

    const canonicalContent = JSON.stringify(template);
    const actualChecksum = computeContentHashSync(canonicalContent);
    if (actualChecksum !== expectedChecksum) {
      logger.warn('Integrity mismatch for built-in template, skipping');
      continue;
    }
    verified.push({ template, relPath });
  }

  registerBuiltinTemplates(verified.map((v) => v.template.id));
  return verified;
}
```

Three gates:

1. **`is_published === false`** — skipped entirely (drafts).
2. **Missing checksum** — skipped. The checksum manifest is
   auto-generated; any template without an entry is treated as
   untrusted. Re-run `node scripts/generate-template-checksums.mjs`
   after adding a template.
3. **Checksum mismatch** — skipped. Either the JSON was edited without
   regenerating checksums, or somebody tampered with the manifest
   without touching the JSON. Either way, drop and log.

Templates that pass all three get registered via
`registerBuiltinTemplates` so the runtime knows which persona IDs
originated from the trusted catalog (vs user-imported templates which
need different handling).

## Checksum algorithm

`scripts/generate-template-checksums.mjs` uses a custom FNV-like hash:

```js
function computeContentHashSync(content) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(16, '0');
}
```

16-hex-char output, e.g. `"000cc85b0ad119c2"`. Not SHA-256 — the
manifest is about integrity-verification-for-UX (catching accidental
desync), not cryptographic authenticity. For that, the backend has a
separate layer (see [06-integrity-and-security.md](06-integrity-and-security.md)).

`computeContentHashSync` also exists in
`src/lib/templates/templateVerification.ts` and must stay
byte-identical to the generator.

## Two checksum manifests

The generator writes to TWO places:

```
src/lib/personas/templates/templateChecksums.ts  (TypeScript, frontend)
src-tauri/src/engine/template_checksums.rs        (Rust, backend)
```

Both are auto-generated. Do not edit by hand.

```bash
node scripts/generate-template-checksums.mjs
```

The Rust manifest is compiled into the binary via `LazyLock<HashMap>`
at startup — meaning:

**⚠️ Critical: editing a template JSON requires a `tauri dev` restart**
for the Rust backend to accept the new content via
`check_template_integrity` (in `template_adopt.rs`). The frontend
picks up changes via Vite HMR + the dev-mode catalog cache
invalidation, but the Rust binary won't.

Symptom of a missed restart: adoption succeeds but you see stale
content OR the backend rejects the template with
`AppError::Validation("Template integrity verification failed")`.

## Module-level cache (`_cached`)

```ts
let _cached: VerifiedEntry[] | null = null;
let _loading: Promise<VerifiedEntry[]> | null = null;

export async function getTemplateCatalog(): Promise<TemplateCatalogEntry[]> {
  if (_cached) return _cached.map((v) => v.template);
  if (!_loading) _loading = loadAndVerify();
  _cached = await _loading;
  return _cached.map((v) => v.template);
}
```

This cache is **module-level**, not component-level. It survives:

- Component remounts
- React re-renders
- Vite HMR when only *JSON files* change (Vite doesn't re-execute
  `templateCatalog.ts` because nothing in the module code itself
  changed)

And it's explicitly invalidated by:

- Full page reload (clears the JS runtime entirely)
- `invalidateTemplateCatalog()` export (drops `_cached` and `_loading`
  so the next call re-invokes `loadAndVerify`)

`useDesignReviews.ts` calls `invalidateTemplateCatalog()` at the start
of every `seedCatalogTemplates` run **in dev mode only** so template
JSON edits flow through without a page reload. Production builds
don't need this because the bundle is immutable.

If you touch the catalog loading logic, make sure `_cached` and
`_loading` stay paired — invalidating one without the other creates a
race where concurrent callers see inconsistent results.

## Backend verification (layer 2)

After `getTemplateCatalog()` returns, the frontend can optionally call
`verifyTemplatesWithBackend()` which ships all verified entries to the
Rust side for a second check against
`src-tauri/src/engine/template_checksums.rs`.

```ts
const result = await invokeWithTimeout<BackendIntegrityResult>(
  'verify_templates_integrity',
  { entries }
);
```

The Rust side recomputes the same FNV hash on each submitted
`content` string and returns per-entry `{expectedHash, actualHash,
valid, isKnownTemplate}`. This isn't called on every load — it runs
once at startup as a sanity check and logs mismatches to Sentry.

The authoritative security gate is `check_template_integrity` in
`template_adopt.rs` which runs on every adoption call (before
`create_adoption_session`). It cross-references the incoming
`design_result_json` against the compiled-in manifest — any mismatch
blocks the adoption.

## Seeding into the DB

`src/lib/personas/templates/seedTemplates.ts`:

```ts
function templateToReviewInput(template, runId): SeedReviewInput {
  const payload = template.payload;
  const connectors = (payload.suggested_connectors ?? []).map(c => c.name);
  const triggers = (payload.suggested_triggers ?? []).map(t => t.trigger_type);

  return {
    test_case_id: template.id,
    test_case_name: template.name,
    instruction: template.description,
    status: 'passed',
    structural_score: 100,
    semantic_score: 100,
    connectors_used: JSON.stringify(connectors),
    trigger_types: JSON.stringify(triggers),
    design_result: JSON.stringify(payload),    // ← the whole payload
    use_case_flows: payload.use_case_flows ? JSON.stringify(...) : null,
    test_run_id: SEED_RUN_ID,                   // 'seed-category-v1'
    reviewed_at: new Date().toISOString(),
    category: template.category?.[0] ?? null,
  };
}
```

Key observations:

- **`design_result = JSON.stringify(payload)`** — the entire template
  payload, verbatim. This is what `MatrixAdoptionView` later reads.
  Any edit to the template JSON flows here unchanged.
- **`test_run_id` is a constant** — all seed rows share
  `'seed-category-v1'`. The ON CONFLICT key is
  `(test_case_name, test_run_id)`, so re-seeding the same template
  triggers UPDATE, not INSERT-duplicate.
- **`adoption_count` and `last_adopted_at` are NOT written** by the
  seed path. They're managed separately and preserved by the ON
  CONFLICT UPDATE.

## `batchImportDesignReviews` → `batch_create_reviews`

Frontend wrapper at `src/api/overview/reviews.ts:139`:

```ts
export const batchImportDesignReviews = (inputs: ImportInput[]) =>
  invoke<number>("batch_import_design_reviews", { inputs });
```

Rust handler at `src-tauri/src/commands/design/reviews.rs:1325`:

```rust
pub fn batch_import_design_reviews(
    state: State<Arc<AppState>>,
    inputs: Vec<serde_json::Value>,
) -> Result<u32, AppError> {
    require_auth_sync(&state)?;
    let mut review_inputs = Vec::with_capacity(inputs.len());
    for input in inputs {
        let import_input: ImportDesignReviewInput = serde_json::from_value(input)?;
        let mut review_input: CreateDesignReviewInput = import_input.into();
        if review_input.category.is_none() {
            review_input.category = Some(infer_template_category(
                &review_input.instruction,
                review_input.connectors_used.as_deref(),
            ));
        }
        review_inputs.push(review_input);
    }
    repo::batch_create_reviews(&state.db, &review_inputs)
}
```

The DAO uses a prepared INSERT with ON CONFLICT UPDATE:

```sql
INSERT INTO persona_design_reviews (
  id, test_case_id, test_case_name, instruction, status,
  structural_score, semantic_score, connectors_used, trigger_types,
  design_result, ...
) VALUES (?1, ?2, ..., ?20)
ON CONFLICT(test_case_name, test_run_id) DO UPDATE SET
  test_case_id = excluded.test_case_id,
  instruction = excluded.instruction,
  design_result = excluded.design_result,
  ...
```

This is why seeding is idempotent and safe to re-run. Every field
except `id`, `adoption_count`, and `last_adopted_at` is updated to the
latest template values.

## Stale seed pruning

`deleteStaleSeedTemplates(seedRunId, activeIds)` removes rows where
`test_run_id = seedRunId` but `test_case_id NOT IN activeIds`. Runs
after every seed to clean up templates that were renamed or removed.

Only affects seed rows — user-imported or user-generated reviews are
untouched.

## SWR layer

`useDesignReviews` wraps `listDesignReviews` in a
`createSWRFetcher(SWR_KEY)` for stale-while-revalidate caching:

```ts
const { data, fromCache } = await fetchReviewsSWR();
```

- **Cold start**: `fromCache = false`, seeds inline before showing
  data.
- **Warm start**: `fromCache = true`, shows cached data immediately
  and kicks off seed + refetch in the background.

`invalidateSWRCache(SWR_KEY)` is called after seeding + pruning to
force the next `fetchReviewsSWR` call to hit the backend fresh.

## Known caches in the loading path

Keep this mental model for debugging "why don't I see my changes":

| Cache | Scope | Cleared by |
|---|---|---|
| `moduleLoaders` | Build-time static | `vite` restart |
| `_cached` in templateCatalog.ts | Module lifetime | Full page reload or `invalidateTemplateCatalog()` |
| SWR cache for `design-reviews` | Session | `invalidateSWRCache(SWR_KEY)` or full reload |
| SQLite `persona_design_reviews` rows | Disk | Re-seed (runs on every `useDesignReviews` mount) |
| Rust `CHECKSUM_MANIFEST` | Compiled-in `LazyLock` | `tauri dev` restart |

Order of "things to try" when edits aren't flowing:

1. Did you run `node scripts/generate-template-checksums.mjs`?
2. Did you restart `tauri dev`?
3. Hard page reload (`Ctrl+Shift+R`) in the WebView.
4. Last resort: delete the `persona_design_reviews` row for the
   affected template and let the seed re-create it.

## Performance notes

- **Lazy loading**: the glob only builds module stubs at build time.
  First `getTemplateCatalog()` call does all the JSON parsing + hash
  computation. For ~100 templates this takes ~50–100ms.
- **Cache hits are O(1)**: once `_cached` is populated, subsequent
  calls are a map operation.
- **Full payload serialized per seed**: `JSON.stringify(payload)` runs
  on every seed call. Templates are small (5–30 KB each), so this is
  fast, but it does allocate ~2 MB of JSON per seed pass. Not a hot
  path — it runs once per component mount.
- **Backend integrity check is per-adoption**: `check_template_integrity`
  recomputes the hash of `design_result_json` on every adoption call.
  Same FNV algorithm, runs in microseconds.
