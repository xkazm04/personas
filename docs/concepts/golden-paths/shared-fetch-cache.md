# Golden path — Shared fetch cache

> Situation node: `client-runtime/data-fetching/shared-fetch-cache` ·
> [situation spine](../situation-spine.md) · recurrence 29 · risk **medium** ·
> sides: **client** · convergence: **mixed** ·
> dimensions: **performance · function · cost · code-quality**
> Composed 2026-08-16 against `master` @ `17d059b1f`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`. Every read-named export in
> `src/api/` — **568** across 129 files — had its call sites counted across the **4,296**
> non-api consumer files, producing this leaf's denominator (**135** reads called from ≥2 distinct
> files). All **1,585** registered IPC commands were classified against `tauriInvoke.ts`'s
> auto-dedup prefix contract. Every module-scoped mutable container in the tree — **381** in 212
> files — was enumerated and the **71** cache-shaped ones were hand-classified one by one into
> fetch caches and computation memoisers, and then again by whether they have any invalidation or
> expiry door. All **five** shared caching/dedup primitives read in full —
> `lib/async/createTtlValueCache.ts`, `lib/async/createCachedFetch.ts`,
> `lib/utils/staleWhileRevalidate.ts`, `lib/utils/deduplicateFetch.ts`, `lib/tauriInvoke.ts` — plus
> their consumers `useDataPortability.ts`, `credentialSlice.ts`, `useDesignReviews.ts`, and
> `useDrive.ts`, `LlmTrackingCell.tsx`, `LifecyclePage.tsx`,
> `useLlmPinpoints.ts`, `useSkillTraceModel.ts`, `useTableIntrospection.ts`, `usePassportData.ts`,
> `useScraperData.ts`, `FleetSessionInsights.tsx`, `ApiKeyAuditDrawer.tsx`,
> `SettingsHistoryTab.tsx`, `ByomProviderList.tsx`, `PersonaConfigPanel.tsx`,
> `executionSlice.ts`, `credentialRecipeRegistry.ts`, `safeInvoke.ts` and `StalenessIndicator.tsx`.
> **Two of those five primitives were found late, after the counts were locked** — the correction
> and how the sweep missed them is §12.9, and it is the most transferable thing in this document.
>
> **Measured by execution, not by reading.** An **18-case replay harness** was run under **real
> React 19 + @testing-library/react** in jsdom, driving four subjects across a **simulated
> remount** and an **entity switch**: (A) `LlmTrackingCell`'s `spendCache`, transcribed verbatim;
> (B) `LifecyclePage`'s module cache, transcribed verbatim with its real async boundary; (C) the
> repo's **actual** `src/lib/utils/staleWhileRevalidate.ts` module, imported and exercised, not
> copied; (D) `tauriInvoke.ts`'s auto-dedup (`stableStringify` + the 250 ms TTL map),
> transcribed verbatim. **18/18 pass.** Every number in §0 is a printed result, not an argument.
> No `cargo` was run; no secret value was printed; the harness lived entirely in the scratchpad and
> was deleted with the rest of the working files.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced the sharpest clause in this document
> (§6 clause 4), one **prior-art fix written down as a do-not-regress note** in a sibling, and two
> silences reported as silences.
>
> **Settles:** what two components wanting the same data should share, what the cache is keyed by,
> when it is thrown away, and what the reader is told about its age.

---

## 0. The headline

**A cache in this repo can render one entity's data under another entity's name, and it does it in
the cell that reports how much money a project spent.** `src/features/teams/sub_factory/passport/LlmTrackingCell.tsx:20`:

```ts
/** projectId → 30d spend in USD (null = fetched, nothing to show). Session-scoped. */
const spendCache = new Map<string, number | null>();
```

The key is the project `slug`. The **value** is a function of `credId` — the observability
connector currently bound to that project (`:29`) — and `credId` is not in the key. The effect
depends on it (`:58 — [slug, credId, cred]`) and, on re-run, takes the cache branch before it can
matter (`:34-37`):

```ts
if (spendCache.has(slug)) { setSpend(spendCache.get(slug)); return; }
```

while the label directly above the number is the **new** connector's name (`:61`,
`const headline = cred?.name ?? label`). Replayed under real React:

| step | what the cell renders | what is true |
|---|---|---|
| bind project `acme` to **Langfuse prod** | `Langfuse prod` · `≈$412.50/30d` | correct |
| unmount, remount (warm) | `Langfuse prod` · `≈$412.50/30d`, **0 extra fetches** | correct — this is the feature working |
| **rebind `acme` to Helicone staging** | **`Helicone staging` · `≈$412.50/30d`** | **`≈$7.25/30d`** |

Printed by the harness: `A2 RENDERED: Helicone staging $412.5/30d | fetches: [{"credId":"cred-langfuse"}]`.
**The second connector is never asked.** There is no TTL, no `delete`, no `clear` — the wrong
number stands for the rest of the session, and it is attributed, in the same DOM node, to a
connector that never produced it.

The same cache also converts a failure into a permanent silence (`:48-53`):

```ts
.catch((e) => {
  // Telemetry being down must never degrade the wall — cache the miss so
  // we don't retry it on every re-render.
  spendCache.set(slug, null);
```

Replayed: after one 503, `spendCache.get('acme') === null` and **zero** further fetches occur for
the rest of the session, on any mount, for any connector. The comment is right about the goal and
wrong about the durability — "don't retry on every re-render" was implemented as "never retry".

### Then look at the denominator

| | count | |
|---|---:|---|
| read-named exports in `src/api/` | **568** | across 129 files |
| — called from ≥1 non-api file | **464** | |
| — **called from ≥2 distinct consumer files** | **135** | **the denominator of this leaf**, 472 call sites |
| — called from ≥3 files · ≥5 files | **53** · **21** | top: `listCredentials` in **18** files |
| module-scoped cache containers, hand-rolled | **71 in 48 files** | the census population (§9) |
| — of which memoise a pure computation (no IO) | **10** | named in §9, listed on purpose |
| — of which cache a **fetched** value | **61** | |
| — — with **any** invalidation or expiry door | **21** | |
| — — with **none**: write-once, never expires, never cleared | **40** (66%) | §7 D2 |
| call sites of the repo's **five** shared cache/dedup primitives | **12 in 7 files** | §9 positive control |
| Zustand store files carrying a freshness/TTL gate | **9 of 93** | |
| `StalenessIndicator` render sites | **5, in 2 files** | both in Overview |
| a reusable `Loadable<T>` / `AsyncState<T>` / `Cached<T>` | **0** in six codebases | §6 clause 6 |

### The repo has SIX shared answers. Five of them are almost unused, and the best one for a multi-entry cache was missing from this table entirely until 2026-08-30.

> **Corrected 2026-08-30 — a sixth primitive, found the same way §12.9 found the fifth.** `src/hooks/utility/data/useModuleSubscription.ts:52`'s `createModuleCache` was absent from every count in this document's §0 sweep. It is a `Map`-backed factory (the exact shape §12.9(a) already names as invisible to a name-based scan) with **key + `ttlMs` + `maxSize` (LRU-style eviction on overflow) + `invalidate`/`invalidateAll` + a `useSyncExternalStore`-based subscription hook** — the only one of the six that has an eviction door at all. It is now the **preferred primitive for new multi-entry value caches**: `createTtlValueCache` remains correct for existing single/few-key adopters (`useDataPortability.ts`) and is not being migrated on this pass, but a new cache keyed by an unbounded or large-domain entity (project id, credential id, file path, …) should reach for `createModuleCache` first, because it is the only one of the six that bounds itself.

| primitive | what it does | consumer call sites |
|---|---|---:|
| `src/lib/tauriInvoke.ts:143-176, :336-395` — auto-dedup | folds concurrent identical `list_*`/`get_*`/`fetch_*` reads into one round-trip; 250 ms TTL after settle; `structuredClone` per extra caller; rejections evicted immediately | **every caller, automatically** |
| **`src/lib/async/createTtlValueCache.ts:34`** | **module-scope value cache, keyed, TTL'd, `get`/`set`/`delete`/`clear`.** Its docstring names the exact population this leaf is about: *"When a component instead holds its fetched data in local `useState`, that data is lost on unmount … This cache stores the value itself at module scope, so a remount within the TTL window can seed local state from the cache and skip the IPC entirely."* | **1** |
| **`src/hooks/utility/data/useModuleSubscription.ts:52` — `createModuleCache`** | **module-scope `Map` cache with key + `ttlMs` + `maxSize` eviction + `invalidate`/`invalidateAll`, plus a paired `useModuleSubscription`/`useModuleCacheSubscription` hook (`useSyncExternalStore`) so components re-render on `notify()`.** The only one of the six with a bounding door — `evictOverflow` drops expired entries first, then least-recently-written, on every `set`. **Preferred for new multi-entry value caches** (see the correction above). | **3** (`useBulkHealthcheck.ts`, `useCredentialHealth.ts`, and one pure-computation memoiser in `formatters.ts`) |
| **`src/lib/async/createCachedFetch.ts:41`** | **in-flight collapse + TTL freshness, keyed at CALL time** (`run(key, fetcher, onHit)`); records freshness **only on success, so a failure is never cached**; `invalidate(key?)` clears **both** the timestamp map and the in-flight map | **1** |
| `src/lib/utils/deduplicateFetch.ts:19, :40` | in-flight coalescing by key, released in `.finally()` | **4** (all Zustand slices) |
| `src/lib/utils/staleWhileRevalidate.ts:55` | TTL + in-flight dedup + LRU cap 500 + `invalidateSWRCache` | **1 file**, 2 constructions |

**Adoption is inversely proportional to how much the primitive asks of you, and it has nothing to
do with quality.** The one nobody has to adopt covers everything. The four that need a call get
**12 call sites in 7 files** between them, while **48 files hand-roll a module cache**. And the
ranking is not by merit: **`createTtlValueCache` is the best answer in the repo** — keyed, TTL'd,
invalidatable, tested, written *specifically* for the useState-backed remount
case that D2/D3's 40 sites are — and it has **one** consumer
(`useDataPortability.ts:27`). `createCachedFetch` likewise has one (`credentialSlice.ts:33`).
Their invalidation doors — `TtlValueCache.delete()` and `CachedFetchController.invalidate()` —
have **zero** callers outside their own tests. `noAutoDedup` has **zero** callers outside
`tauriInvoke.ts` itself.

**This corrects my own first reading, and the correction is the finding.** I initially concluded
the repo had three primitives and that the un-adopted one had the wrong signature (a
construction-time key). Both halves were wrong: there are five, and the fifth already has the
signature I was about to prescribe. Its own docstring records that it was *"established by the
/architect perf scan (per-visit-refetch convention gap)"* — the extraction was done, deliberately,
against exactly this problem. **The blocker is not the signature. It is that nothing routes anyone
to it**, which is what §9 exists for. See §12.9 for how the sweep missed it and why that miss was
predictable.

### And the automatic one covers exactly half of the shared reads

`tauriInvoke.ts:161` defines the eligibility contract as a **prefix**:

```ts
const READ_ONLY_PREFIXES = ["list_", "get_", "fetch_"] as const;
```

Measured two ways:

- Over the **135 shared reads**: **68 eligible, 67 not.**
- Over the **whole IPC surface**: 1,585 registered commands; **314 (19.8%)** carry an eligible
  prefix; **578** are read-shaped by any naming convention in the tree; **264 of those 578
  (45.7%) are invisible to the dedup.** By namespace: `dev_*` **75**, `companion_*` **41**,
  `lab_*` 17, `twin_*` 13, `obsidian_*` 10, `cloud_*` 9, `research_*` 9.

The cause is mechanical and has nothing to do with anyone's judgement: this repo names namespaced
commands `<area>_list_x`, and `dev_tools_list_kpis` does not start with `list_`.
`listKpis` is called from **5** files and is deduped **never**;
`list_personas` is called from 6 and is deduped **always**. Executed (harness D7): two concurrent
`read_transcript` calls and two concurrent `search_memories` calls produce **4** backend round
trips. This is the mechanism [`idempotent-invocation`](./idempotent-invocation.md) noticed the
read-command naming contract silently depends on — quantified: **the contract is a prefix and the
convention is an infix, so it misses on almost half the reads and nothing anywhere reports it.**

### The type that could say "stale" exists, is exported, and is never returned

`src/lib/utils/staleWhileRevalidate.ts:39-44`:

```ts
export interface SWRResult<T> {
  /** The data (possibly stale). `undefined` only on first fetch. */
  data: T | undefined;
  /** Whether a background revalidation is in progress. */
  isRevalidating: boolean;
}
```

`createSWRFetcher` returns `{ data: T; fromCache: boolean }` instead. `SWRResult` has **0**
references in 4,829 files outside its own declaration — doctrine Q3 at its sharpest: *someone
wrote the type that expresses the fourth state, and then did not return it.* Executed (harness
C5): a stale entry whose background revalidation **rejects** is re-served as
`{data:'fresh', fromCache:true}` — identical, byte for byte, to a healthy stale hit. The rejection
goes to `silentCatch` (`:95`) and the caller is told nothing.

### Three more, executed

**1 — `invalidateSWRCache` does not clear the in-flight map.** `:105-107` deletes from `_cache`
and leaves `_inflight` (`:16`) alone. Replayed: a fetch in flight, `invalidateSWRCache(key)`, then
a second fetch → **the second joins the pre-invalidation request and gets the pre-mutation value;
the invalidation was a no-op.** This is reachable in the primitive's only consumer:
`useDesignReviews.ts:85-86` is literally `invalidateSWRCache(COUNT_SWR_KEY); await
fetchReviewCountSWR();` and `refreshCount` is called from **four** places that can overlap —
`refresh()` (`:118`), the post-seed path (`:156`), the mount effect (`:170`), and the run-completion
handler (`:330`). The post-seed one carries its own comment: *"Seeding is exactly when the total
moves — recount, or the header keeps reporting the pre-seed number."* When it overlaps with any of
the other three, it reports the pre-seed number.

**2 — the shared SWR cache hands every caller the same object.** Executed (C2): caller 1's
`.push()` is visible to caller 3, because `_cache` stores the resolved value by reference and
`createSWRFetcher` returns it unwrapped. **`tauriInvoke.ts:361-367` already solved this**, with the
reason in the comment — *"one caller's in-place mutation (`.sort()`/`.push()`, a mutating store
reducer) silently corrupts the others"* — and `structuredClone`s for every additional caller. Two
caches in one repo, same hazard, one fixed and one not.

**3 — `useDrive.ts` clears the wrong one of its two caches, seven times.** It has a component-local
`pathCacheRef` (`:294`) and a module-scoped `driveEntriesCache` (`:71`). Every mutation handler —
paste, mkdir, createFile, rename, delete, move, trash — calls `pathCacheRef.current.clear()`, **7
occurrences**, under a comment naming the exact bug it fixes (`:647-650`: *"the columns view kept
serving stale/deleted entries from pathCacheRef"*). **Not one of them touches
`driveEntriesCache`**, which is the copy that survives the unmount and seeds the next visit
(`:251`, `:313-315`). Worse, `refresh()` re-seeds the ref *from* the module cache at `:313-315`, so
the clear is partly undone one line later; on the current path a round-trip corrects it, and on
every other path nothing does. **The invalidation discipline was applied to the cache that dies
anyway and skipped on the cache that persists.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics.** **A cache key must contain every input the value depends on, or the cache is a
> claim about the wrong entity.** Not the id you happened to render by; every input the fetch read.
> A key that omits one input does not degrade gracefully — it returns confidently wrong data under
> a correct-looking label, and the label is what the reader trusts.
> *Warrant: found live here and independently in two sibling repos; a third had it, diagnosed it,
> fixed it by widening the key, and wrote a do-not-regress comment forbidding the narrowing.*
>
> **P2 — physics.** **A cache with no invalidation door is a decision that the data never
> changes.** Make that decision explicitly or not at all. Every cache needs one of three: a TTL, an
> explicit invalidate called by the writes that change it, or a written statement that the value is
> immutable for a session. "It refreshes behind the paint" is not a fourth option — it is the
> statement that the *first frame* may be arbitrarily old.
> *Warrant: 66% of this repo's module fetch caches have none of the three; client-side across the
> fleet the ratio of caches to caches-with-any-invalidation is ~4:1, while the same fleet's
> server-side code is 20:20.*
>
> **P3 — physics.** **Deduplication belongs at the transport, caching belongs at the surface, and
> the two are different problems.** Coalescing concurrent identical requests is always safe and
> should be automatic and invisible. Retaining a value past its request is never automatically safe
> and must be a decision someone made. A layer that does both at once cannot be reasoned about,
> because "why is this stale" and "why did this only run once" have the same answer.
> *Warrant: the one repo in the fleet with transport-level dedup gets it right in every case
> measured (5 concurrent callers → 1 round trip, rejections not cached, no cross-caller aliasing),
> and its surface-level caches — written by the same people — get it wrong in 40 places.*
>
> **P4 — physics.** **A cached value must be able to say how old it is, and the thing that decides
> what to render must be able to ask.** If the age is not carried with the value, the render site
> has no way to disclose it and no way to decide, and the disclosure will be added — if ever — as a
> mount timestamp, which is a clock on the component rather than on the data.
> *Warrant: the sibling with the most disclosure sites in the fleet feeds 6 of its 7 a
> component-mount timestamp; another plumbs the real fetch time to two hook boundaries and renders
> it zero times.*
>
> **P5 — ergonomics, and the one that predicts the rest.** **A cache primitive that nobody can
> find is worth exactly as much as one that does not exist, and being correct does not make it
> findable.** Caching is written locally, by whoever is fixing a re-ghosting tab, under a name they
> chose; a shared answer living in a different directory under a different noun will not be reached
> unless something routes them to it. Ship the primitive *and* the signal that points at it, or
> expect the population of hand-rolls to grow monotonically.
> *Warrant: measured directly, and the composer of this document fell in it first — a repo with
> five shared caching primitives, of which the two best were deliberately extracted against exactly
> this defect, tested, and catalogued, has 12 call sites reaching them and 48 files hand-rolling.
> A second repo in the fleet has a complete TTL/LRU/invalidate-by-pattern cache used by one module,
> and a shared cache-policy config with **zero** importers while every consumer redefines the same
> literal.*
>
> **P6 — physics.** **An automatic optimisation keyed on a naming convention is a contract, and a
> contract nobody can see is a contract nobody keeps.** If eligibility depends on how a call is
> spelled, the ineligible half will grow silently and no signal will ever fire.
> *Warrant: 264 of 578 read-shaped commands in one codebase sit outside an eligibility rule that
> is one `const` array in one file, and the miss correlates perfectly with a namespace prefix that
> the rest of the codebase adopted for unrelated reasons.*
>
> **P7 — physics.** **A failed read must not become a cache entry.** A cache that stores failures
> converts a transient outage into a permanent one, and stores it as the one value the UI reads as
> "nothing to show". Evicting on rejection is one line and it is not optional.
> *Warrant: transport-level dedup in this codebase evicts rejections immediately and says why; a
> surface-level cache three directories away caches the failure as `null` on purpose, and a replay
> shows it never retries again.*
>
> **P8 — ergonomics.** **A cache handed to more than one consumer must be handed out immutably, or
> copied.** Sharing the win is the point; sharing the *object* means the second reader inherits the
> first reader's `.sort()`.
> *Warrant: one repo, two caches, same hazard — the transport one clones and documents why, the
> surface one does not; replayed, a `push()` in caller 1 is visible to caller 3.*
>
> **Scale condition.** P1, P3 and P7 are correctness on day one. P2 and P8 bite the first time a
> second surface reads the same cache. P4 and P5 bite the first time someone tries to fix P2. P6
> bites silently and forever, and only a census sees it.

---

## 1. Trigger

- "Two components both need this list — where should it live?"
- "This tab re-fetches everything every time I switch back to it."
- "I'll stash the last fetch in a module variable so a remount paints warm."
- "Both panels mount at once and I see the same IPC call twice in the log."
- "The number is wrong but it fixes itself if I reload."
- "It's showing the old project's data for a second after I switch."

**If you are about to write** a `let cached…` / `const …Cache = new Map()` at module scope, or to
add a second call site to a read that already has one, or to type `staleTime` / `TTL` / `fetchedAt`
— **you are in this situation.**

You are **not** in this situation for a memoiser over a value you already have in memory (that is a
`useMemo` or a `WeakMap` and needs none of this), or for the first frame of a single-source read
(that is [`page-loading`](./page-loading.md)).

### Boundaries with the adjacent leaves

- [**`page-loading`**](./page-loading.md) owns **what the screen shows while a fetch runs**, and its
  mechanic 4 (*"stash the last fetch in a module-scoped cache keyed by entity"*) is what creates
  this leaf's population. That path prescribes the cache; **this path owns its key, its expiry and
  its disclosure.** Its §Gaps 3 is corrected here (§12.1).
- [**`partial-failure-read-envelope`**](./partial-failure-read-envelope.md) owns **what a failed
  source's value is.** This path owns **how long that value is kept and who else sees it.** Its P7
  (*"a read that half-failed must not be cached as if it succeeded"*) is this leaf's P7 arriving
  from the other direction; the composition is §12.4.
- [**`stale-response-guard`**](./stale-response-guard.md) owns **an out-of-order response for one
  caller.** This path owns **a value deliberately retained across callers and mounts.**
- [**`debounced-autosave`**](./debounced-autosave.md) owns **a write that is scheduled for later.**
  The pair is a defect and is already recorded there; §12.5 extends it.
- [**`idempotent-invocation`**](./idempotent-invocation.md) owns **a duplicated
  side effect.** This path owns **a duplicated read**, and quantifies the eligibility contract
  that path found the read-command naming depends on (§0).
- [**`zustand-domain-slices`**](./zustand-domain-slices.md) owns **where shared state lives.** This
  path owns **when the state is allowed to be old.**

## 2. The one way

**Decide, before you write the cache, what identity the value has and what event ends its life —
and put both in the code rather than in your head.** Concretely: (a) **do not write a cache for
concurrency**; concurrent identical reads are already folded at the transport, so if your reason is
"two components mount at once", check the command name is `list_*`/`get_*`/`fetch_*` and stop —
and if it is not, **rename the command**, which fixes it for every caller, rather than caching at
one of them. (b) **If the value is shared state, it goes in a Zustand slice with a `fetchedAt` and
a TTL gate**, not in a module variable; a module cache is for a view whose data is *local* and
whose remount would otherwise re-ghost, which is a narrow case. (b2) **In that narrow case, do not
write the `Map` — call `createTtlValueCache(ttlMs)`**, which is that `Map` with a timestamp, a
`delete(key)` and a test, and which was extracted for precisely this situation. Reach for
`createCachedFetch` instead when the data already lives in a store and only the freshness needs
tracking. (c) **Whichever you use, key it on every input the fetch reads** — entity id, filter, window, locale, and the credential or
connection it went through — because a key that omits one input returns the wrong entity's data
under the right entity's name (§0); prefer building the key with a named function beside the cache
so the reader and the writer cannot derive it differently. (d) **Store `{ value, fetchedAt }`,
never a bare value** — the timestamp is what makes an expiry, a disclosure and a debugging session
possible, and adding it later means touching every write site. (e) **Give the cache exactly one
invalidation door and call it from every mutation that changes the data** — an exported
`invalidateX(key)` next to the cache, imported by the writers; if the value is genuinely immutable
for a session, write that sentence in the declaration comment instead. (f) **Never cache a
rejection**; evict on failure so the next caller retries, and if you must remember a failure,
remember it as a *failure*, not as an empty value. (g) **Hand out a copy, or freeze it** — a cache
read by two components that returns the same array will be sorted in place by one of them. (h)
**If you paint from the cache, say so** — the render site gets the `fetchedAt`, and any surface
that keeps data through a failed refresh renders the shared staleness badge. Then stop: do not add
a second cache in front of a store slice, do not add a TTL to a cache that has no timestamp, and do
not "fix" a stale paint by removing the cache — that trades a rare wrong frame for a guaranteed
slow one.

If you must get one right first: **(c)**. (a), (b) and (e) cost performance or freshness, which a
user can see and report. (c) produces a number that is confidently, invisibly about a different
entity, and the label beside it says the number is trustworthy.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/lib/tauriInvoke.ts:143-176, :336-395` — auto-dedup | **concurrency, solved, for free.** Keyed `${cmd}:${stableStringify(args)}`; folds N concurrent identical reads into one round-trip (**executed: 5 callers → 1 backend call**); `structuredClone`s for every extra caller so nobody aliases; **evicts rejections immediately**; 250 ms TTL after settle for StrictMode/init races. Eligible **only** for `list_*`/`get_*`/`fetch_*` — check your command name before writing anything else. |
| **`src/lib/async/createTtlValueCache.ts:34` — `createTtlValueCache<V, K>(ttlMs)`** | **the answer for the module-cache case, and the one to reach for first.** `get(key)` returns the value only if it is inside the window; `set(key, value)` stamps the time for you; `delete(key)` is the invalidation door; `clear()` is the reset. Keyed at call time, so the per-entity case is one line. Its docstring already names the two inline patterns it was extracted from (`configCache`, `lastPipelineRun`) and states the rule this path's §2(e) repeats: *"Invalidate a key after a mutation that changes the underlying data so the next read refetches."* Tested (`__tests__/createTtlValueCache.test.ts`). **1 consumer.** |
| **`src/lib/async/createCachedFetch.ts:41` — `createCachedFetch({ttlMs, rethrow})` → `run(key, fetcher, onHit)` / `invalidate(key?)`** | **the answer when the data lives in a store and only the freshness needs tracking.** Collapses a concurrent burst onto one in-flight promise, gates on a per-key TTL, and — the part to copy — *"records freshness only on success, so failures aren't cached"* (`:66-70`), with `invalidate()` clearing **both** `lastFetchedAt` and `inflight`, which is the fix `invalidateSWRCache` still needs (§7 D7). Tested. **1 consumer** (`credentialSlice.ts:33`, whose 24-line comment is the best written statement of a caching decision in the repo). |
| `src/lib/utils/deduplicateFetch.ts:19` `deduplicateFetch(key, fn)` · `:40` `deduplicateKeyedFetch(prefix, fn)` | **in-flight coalescing with no retention at all**, for a read that is not IPC-eligible. Deleted in `.finally()`, so a rejection is never held. The keyed variant derives the key from the arguments — copy this when the key must not be forgettable. 4 call sites, all Zustand slices. |
| `src/lib/utils/staleWhileRevalidate.ts:55` `createSWRFetcher(key, fn, ttlMs)` | TTL (default 30 s), in-flight dedup, LRU cap of 500 with a written rationale (`:21-29`), `invalidateSWRCache(key)` / `clearSWRCache()`. Returns `{ data, fromCache }` so a caller *can* branch on provenance — `useDesignReviews.ts:167-186` is the only place that does. **Prefer the two `src/lib/async` primitives above it**, and read §8 Gap 2 before adopting this one: its key is bound at construction, it aliases the cached object, and its invalidation misses in-flight. |
| `src/hooks/database/useTableIntrospection.ts:35-52` | **the best hand-rolled cache in the repo, and the one to copy if you must hand-roll.** Three caches, all keyed by `credentialId` (columns by `` `${credentialId}:${tableName}` ``), a `boundedSet` LRU with stated caps, an exported `clearCacheForCredential(id)` that also sweeps the composite-keyed map by prefix — **and a real caller**, `useSchemaProposal.ts:207`, invalidating after a schema write. Key derivation, bound, invalidation, and a writer that uses it. |
| `src/features/teams/sub_factory/passport/usePassportData.ts:82-88` | **the timestamped warm snapshot.** `{ passports, rawByProject, generatedAt, at }` with `CACHE_FRESH_MS = 60_000`; every publish refreshes it; and the publish is guarded by a latest-wins generation token (`:110-118`) because *five* independent callers can trigger a build. Copy the `at` field and the token. |
| `src/features/plugins/dev-tools/sub_llm_overview/useLlmPinpoints.ts:51-54, :73` | **the sibling-key idiom**, the repo's answer to "a scalar cache needs a key": `cachedProjectId` + `cachedWindow` beside `cachedPinpoints`, and a single `warmForProject` predicate that must match **all** of them before the warm value is used. Verbose, and it is the only hand-rolled form that survives an entity switch. |
| `src/features/plugins/fleet/sub_grid/FleetSessionInsights.tsx:27-33` | **timestamped entries + a test-reset door.** `Map<id, {summary, at}>`, `SUMMARY_TTL_MS`, a `force` argument that bypasses on manual refresh, and an exported `__resetInsightsCacheForTests()` — the only module cache in the tree that admits it leaks between tests. |
| `src/features/shared/components/feedback/StalenessIndicator.tsx:22` | **disclosure of age next to the data.** `fetchedAt` + `hasError` → an amber "N minutes ago · refresh failed" badge, `null` when fresh and healthy, i18n'd, props-only, self-ticking every 30 s. **5 render sites, both files in Overview.** Its comment at `:33-40` records the one bug worth knowing: the error arm must sit **above** the no-timestamp guard, because a source that has never succeeded has no `fetchedAt` and that is exactly when it has the most to say. |
| `src/lib/utils/tauri/safeInvoke.ts:61` | **the narrow fallback.** Returns the fallback **only** for "this command isn't registered", by anchored regex, with the history of the substring version in the docstring (`:21-43`). If you are about to write a fallback for a read, this is the only shape that is allowed to have one. |

**Do NOT build:** a `new Map()` at module scope for a fetched value — `createTtlValueCache(ttlMs)`
is that Map with a timestamp and a `delete()`, and it is one import; a module cache keyed by less
than the fetch reads (§7 D1); a module cache with no timestamp (§7 D3, 40 sites); a module cache
with no invalidation door where a mutation exists (§7 D4); a cache in front of a Zustand slice that
already has one; a second in-flight map beside `deduplicateFetch` or `createCachedFetch`; a
`.catch(() => cache.set(k, null))` (§7 D5); a cache that hands the same array to two components
(§7 D6); a per-entity `createSWRFetcher` instance inside a component body — it would allocate a new
closure per render and share the module cache under one fixed key.

## 4. Steps

1. **Ask whether you need a cache at all.** If the reason is "two components mount together", look
   at the IPC command name. `list_*`/`get_*`/`fetch_*` → already deduped, write nothing. Anything
   else → **rename the command** (`dev_tools_list_kpis` → the eligible form) and fix it for all
   callers; a cache at one call site fixes one call site.
2. **Ask where the value belongs.** Shared across features and mutated → a Zustand slice with
   `fetchedAt` + a TTL gate (9 slices do this; `credentialSlice.ts:32` is the pattern). Local to one
   view that unmounts on nav-away → a module cache. Anything else → neither.
3. **Write the key function before the cache.** `const key = (projectId, window, credId) => …`,
   exported or at least named, so the reader and the writer cannot disagree. List every argument the
   fetch takes and every store value the fetch reads; all of them are in the key.
4. **Store `{ value, fetchedAt }`.** Not the bare value. This is one word now and every write site
   later.
5. **Ask whether the type can make the wrong key impossible — before you write the gate.** For a
   per-entity cache it can, and it is a signature change, not a rule (see below).
6. **Write the invalidation door in the same commit as the cache**, and call it from the writes.
   If there are no writes, put the sentence *"this value is immutable for a session because X"* in
   the declaration comment — that is a decision; silence is not.
7. **Evict on rejection.** `.finally(() => inflight.delete(key))` for the in-flight map;
   `catch { cache.delete(key); throw }` for the value cache. Never `cache.set(key, null)` in a
   catch.
8. **Return a copy.** `structuredClone(v)` on the read path if two components consume it, exactly
   as `tauriInvoke.ts:361-367` does, and for the same reason.
9. **Give the render site the `fetchedAt`.** Then either it renders `StalenessIndicator` or it
   deliberately does not — but it has the number.
10. **Test the entity switch, not just the remount.** One test that mounts with entity A, remounts
    with entity B, and asserts the value changed. Every defect in §7 D1 passes a remount test.
11. **And then stop.** Do not add a TTL to a cache with no timestamp, do not add a second cache in
    front of a store, and do not delete a working cache because it surprised you once — fix the key.

### Can the type make the wrong call impossible? — asked before §9, and the answer is uncomfortable

**For the key: yes in principle, and the type already exists, which is why this section is a
warning rather than a proposal.** The bad state is not "someone forgot `credId`" — it is **"the
cache is a bare `Map` the author keys by hand, so nothing ever checks that the key covers the
fetch, and nothing ever asks when the entry expires."** A type that removes that freedom is
`deduplicateKeyedFetch(prefix, fn)` (`deduplicateFetch.ts:44-45`,
`` const key = `${prefix}:${JSON.stringify(args)}` `` — the key *is* the arguments, so it cannot
omit one), and a type that removes the second half is `createTtlValueCache(ttlMs)`, whose `set`
stamps the time for you and whose `delete` is the door.

**Both were built. Neither reached the code.** Hold that against the qualifications and it is Q3,
sharply:

- **Q3** (a type nobody constructs constrains nothing) — `createTtlValueCache` has **1**
  construction site; `createCachedFetch` has **1**; `createSWRFetcher` has **2**, in one file.
  Against **71** hand-rolled containers. Proposing a *sixth* primitive here would be the corpus's
  own withdrawn advice — the answer is not another type, it is a signal that routes people to the
  ones that exist.
- **Q5/Q6** (withhold the dangerous freedom, not the answer) — `createTtlValueCache` is Q6-correct:
  it withholds the *timestamp bookkeeping and the eviction*, not the key, so callers keep every bit
  of control over what they cache. That is why it is the right destination.
- **Q7** (withholding only helps when the requirement forced the bad value) — this is the
  qualification that bites. `spendCache.get(slug)` is a caller *voluntarily* supplying a short key.
  No type change anywhere makes that caller correct; the fix is to **delete the hand-rolled `Map`**
  and re-key at the new construction site. Relaxing or widening anything is inert.
- **Q1** (a type carries only what it encodes) — honest limit: even a derived key encodes the
  fetch's **arguments**, not values the fetch closes over from a store. `LlmTrackingCell` would be
  fixed (`credId` is an argument to `fetchLlmPinpoints`); `useSkillTraceModel` (§7 D9), whose key
  is resolved from a store *inside* the hook, would not. That residue is what §9's ratchet is for.

**So this leaf inverts the corpus's usual conclusion, and the inversion is the lesson.** The
type-over-gate move has already been made here — twice, deliberately, by an `/architect` scan that
named the convention gap — and it did not move a single one of the 71. **A type that exists and is
not reached constrains nothing, and the missing half is the routing, not the type.** That is the
case where the doctrine says a census rule genuinely earns its place.

**And fix one destination before pointing anyone at it** (contract, fifth §9 failure mode).
`createTtlValueCache` and `createCachedFetch` are ready today. `createSWRFetcher` is not: three
executed defects sit in it — a construction-time key (C3), a value shared by reference (C2), and an
invalidation blind to in-flight (C6) — so §3 ranks it last and §9's control counts it without
recommending it.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A cache key that omits an input the fetch reads** | Confidently wrong data under a correct label, forever. Executed: `Helicone staging · ≈$412.50/30d` when the true figure is `$7.25`, and the new connector is never queried. §7 D1. |
| **A module cache with no timestamp** | No expiry is possible, no disclosure is possible, and "how old is this" has no answer at any layer. **40 of 61.** Adding the field later means touching every write site. §7 D3. |
| **A module cache with no invalidation door, in a file that also mutates** | The write updates the backend and the cache keeps the old answer for the session. `useDrive.ts` clears its *component-local* cache 7 times and its *module* cache 0 times. §7 D2, D4. |
| **`cache.set(key, null)` inside a `.catch`** | A transient outage becomes permanent, and it is stored as the value the UI reads as "nothing to show". Executed: after one 503, zero further attempts for the session. §7 D5. |
| **Caching to solve concurrency** | The transport already folds concurrent identical `list_*`/`get_*`/`fetch_*` reads; a surface cache adds a staleness bug to fix a problem that was already solved. Check the command name first. |
| **Naming a read command `<area>_list_x`** | Silently opts the whole read out of transport dedup. **264 of 578 read-shaped commands**, and no signal anywhere fires. §7 D8. |
| **Returning the cached object itself to two consumers** | Consumer 1's `.sort()`/`.push()` is consumer 3's data. Executed on the repo's own SWR module. §7 D6. |
| **Writing `const xCache = new Map()` at module scope at all** | `createTtlValueCache(ttlMs)` is that `Map` with the timestamp, the expiry and the `delete()` already in it, and it exists because an earlier scan found this exact gap. Every hand-roll re-decides keying, expiry and invalidation from scratch, and 40 of 61 decide "none". §7 D4, §8 Gap 1. |
| **`invalidateX()` that clears the value map and not the in-flight map** | The invalidation is a no-op against any request already in flight, which is precisely the request a mutation races. §7 D7. |
| **Seeding a component-local cache from a module cache you just cleared** | Undoes your own invalidation one statement later. `useDrive.ts:313-315`. |
| **A staleness badge fed a mount timestamp** | It measures how long the component has been on screen, not how old the data is. Found on 6 of 7 sites in a sibling repo; avoid by passing the cache's `fetchedAt`. |
| **"It refreshes behind the paint, so staleness doesn't matter"** | The refresh corrects frame 2. The user reads frame 1, and a screenshot is always frame 1. Executed: a remount paints 3 triggers that no longer exist before settling to 0. §7 D2. |

## 6. Evidence

**The one site to copy, if you are writing a new cache: `src/features/settings/sub_portability/libs/useDataPortability.ts:25-27, :95, :104, :149`** — because it is the only file in the tree
that reaches the right primitive, and doing so takes three lines:

```ts
/** Export stats change rarely (only on import). Cache the value at module
 *  scope so re-visiting the Portability tab seeds from cache instead of
 *  re-issuing the IPC on every mount. Invalidated after a successful import. */
const STATS_KEY = 'stats';
const exportStatsCache = createTtlValueCache<ExportStats>(60_000);
…
const cached = exportStatsCache.get(STATS_KEY);   // undefined once the window closes
…
exportStatsCache.set(STATS_KEY, s);               // the timestamp is stamped for you
```

Three things it gets right that the 71 hand-rolls do not: the TTL is a **constructor argument**, so
"how old may this be" is answered at the declaration; `get` returns `undefined` past the window
rather than a stale value the caller must age itself; and the key is a named constant, so the
single-resource case is explicit rather than implied by the absence of a key. (One residue worth
noting: the comment says *"Invalidated after a successful import"* and `:149` actually **re-sets**
with fresh data rather than calling `delete`. Equivalent here, and it is why `TtlValueCache.delete`
has zero callers in the tree.)

**The one site to copy, if you must hand-roll:
`src/hooks/database/useTableIntrospection.ts:29-57`.**

```ts
const MAX_TABLE_CACHE = 50;
const MAX_COLUMN_CACHE = 200;
const _tableCache = new Map<string, IntrospectedTable[]>();
const _columnCache = new Map<string, IntrospectedColumn[]>();

function boundedSet<V>(map: Map<string, V>, key: string, value: V, maxSize: number) {
  map.set(key, value);
  if (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function clearCacheForCredential(credentialId: string) {   // <- the door
  _tableCache.delete(credentialId);
  _redisKeyCache.delete(credentialId);
  for (const key of _columnCache.keys()) {                        // <- composite keys swept by prefix
    if (key.startsWith(`${credentialId}:`)) _columnCache.delete(key);
  }
}

export function getCachedColumns(credentialId: string, tableName: string) {
  return _columnCache.get(`${credentialId}:${tableName}`);        // <- ONE key derivation, exported
}
```

Five decisions worth copying: (1) **every key carries the connection**, so two databases with a
`users` table cannot collide — the defect §0 shows in a cache that dropped exactly this; (2) the
composite key is built in **one exported function** that both readers use, so a reader and a writer
cannot derive it differently; (3) the bound is explicit and stated, so a long session cannot grow
it without limit; (4) the invalidation door is **exported and actually called** —
`useSchemaProposal.ts:207` invalidates after applying a schema change, which is the half almost
every other cache in the repo is missing; (5) it clears **all three** maps, including the one with
composite keys, which is the sweep `useDrive` does not do.

**When you need per-entity behaviour, copy this signature instead** (`deduplicateFetch.ts:40-54`):

```ts
export function deduplicateKeyedFetch<Args extends unknown[], T>(
  prefix: string, fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return (...args: Args) => {
    const key = `${prefix}:${JSON.stringify(args)}`;   // <- the key is DERIVED, never handed in
    const existing = _inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn(...args).finally(() => { _inflight.delete(key); });  // <- rejection released
    _inflight.set(key, promise);
    return promise;
  };
}
```

The key cannot omit an argument, because it *is* the arguments. That is the whole content of §4's
type argument, already written in this repo, eleven lines long.

**Also exemplary:**

- **`src/lib/tauriInvoke.ts:355-367`** — the aliasing fix, with its reason: *"would otherwise return
  the SAME object/array instance to every caller (held for the TTL), so one caller's in-place
  mutation (.sort()/.push(), a mutating store reducer) silently corrupts the others."* Six lines,
  and the app-level cache three directories away still needs them.
- **`src/lib/tauriInvoke.ts:377-395`** — the two settle paths written as *different* policies:
  fulfilment schedules a TTL eviction guarded by an identity check
  (`if (inflightAutoDedup.get(key) === promise)`, so a newer call is never deleted); rejection
  evicts **immediately**, *"so callers can retry without waiting."* P7 and the stale-eviction race,
  both in one block.
- **`src/features/plugins/dev-tools/sub_llm_overview/useLlmPinpoints.ts:73`** —
  `const warmForProject = !!activeProjectId && activeProjectId === cachedProjectId && cachedWindow === '30d';`
  The sibling-key idiom. Verbose and correct: **all** key components must match before the warm
  value is used, and the window is compared even though it is a literal.
- **`src/features/teams/sub_factory/passport/usePassportData.ts:110-118, :121-124`** — the cache
  write is inside a `publish()` guarded by a latest-wins token, with the reason stated: five
  independent callers can trigger a build and *"whichever build's publish() lands LAST wins — even
  if it started before an explicit user-requested rescan."* A cache write is a write and needs the
  same ordering discipline as one.
- **`src/features/plugins/fleet/sub_grid/FleetSessionInsights.tsx:30-33`** — `export function
  __resetInsightsCacheForTests()`, with the honest comment *"the module-scope cache leaks between
  vitest cases otherwise."* One of one.
- **`src/lib/utils/tauri/safeInvoke.ts:21-43`** — the docstring that names the exact substring bug
  a fallback caused (*"'project not found', 'context not found', 'vault path not found' … all
  silently swallowed as 'command missing, return fallback', producing empty-list UIs"*) and the
  anchored regex that replaced it. This is what a narrow fallback looks like.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** The sweep searched for the *mechanism*
(module `let` + `Map`, promise-keyed maps, TTL constants) **and** the *names* (`StalenessIndicator`,
`Loadable`, `useQueries`, `keepPreviousData`) — the doctrine's blind-spot correction, which is what
turned up clause 5.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **In-flight dedup, where it exists, is uniformly correct** | **PHYSICS (10/10 across 4 repos)** | Every dedup found in the fleet releases on settle: `personas-web/src/stores/personaStore.ts:218-223` (with an **ownership check** so a `reset()` racing the finally can't delete a newer entry), `vibeman/src/lib/api-cache/api-cache.ts:158-160`, `vibeman/src/app/features/tinder/lib/tinderItemsApi.ts:291` (plus a 30 s TTL sweep as a fallback), `ascent/src/lib/cache.ts:215`. **Nobody gets this wrong anywhere.** Personas' `deduplicateFetch.ts:27-29` is the same shape. |
| 2 | **…and it is uniformly ABSENT from the client** | **PHYSICS AS A GAP (4/4 repos with a UI)** | Every dedup above lives in a store, a lib, or a route handler. `ascent` has **79 `fetch(` calls inside `src/components/`** and zero component-level dedup; `brainiac`'s console has 18 and zero. **Personas is the only repo in the fleet that dedupes at the transport**, which is why its component layer can get away with not doing it — clause 3. |
| 3 | **Transport-level automatic dedup** | **LOCAL (1/6) — Personas is ahead, and it is the single best decision in this leaf** | No sibling folds duplicate reads below the call site. Every other repo either pays N round-trips or hand-rolls a coalescer per feature. `ascent/src/lib/cache.ts:203-250` `coalesceScan` is the nearest and is *better in one respect* — **refcounted abort**, `waiters` at `:201`/`:224`, so one client navigating away cannot kill a scan two other tabs are awaiting — but it is one function for one endpoint, not a layer. |
| 4 | **⚠ THE SHARPEST — a cache key that omits part of the identity** | **PHYSICS AS A DEFECT (3 of 6), and one repo already paid for it and wrote the fix down** | `vibeman/src/app/features/Context/sub_ContextGroups/lib/gradientUtils.ts:130` keys on two colours while the cached value bakes in fixed alpha ramps (`:141-146`), and is unbounded and never invalidated. `personas-web/src/hooks/useLiveStats.ts:45` is a **keyless** module singleton holding the last payload — invisible to the logout wipe at `clearUserCaches.ts:29`, whose own comment records that the previous predicate already missed these keys once. And **`ascent` had this exact bug, diagnosed it, and forbade the regression by name**: `src/lib/cache.ts:43-50` widened the key with a `ScoringIdentity {provider, model, rubric}` because *"the key knew only `useLLM` + the sha, so after a model swap / rubric bump every unchanged repo kept serving the OLD score as current, with no bulk-invalidation lever"*, and `:110` adds *"Do NOT 'optimize' the fingerprint back out to reuse old entries; that re-introduces the fleet-wide staleness this key was widened to fix."* **Three codebases, no shared document, same defect — and the one that fixed it wrote P1.** |
| 5 | **A named staleness component** | **MINORITY (2/6), and Personas is BEHIND — with the measurement inverted** | `personas-web/src/components/dashboard/StalenessIndicator.tsx` has **7 render sites** against our 5, plus i18n and an error arm. But the oracle also found the thing a mechanism-only sweep would have missed: **6 of those 7 seed `fetchedAt` with `useState(() => Date.now())` at mount** (`leaderboard/page.tsx:29`, `messages/page.tsx:40`, `sla/page.tsx:21`, `EventSwimlane.tsx:18`, `HealthDigestPanel.tsx:28`, `MemoryActionsPanel.tsx:79`) — a clock on the component, not on the data, reading "just now" over a value SWR may have served from cache. `ascent` has no such component and **18** correct sites, all reading `scannedAt`/`generatedAt`/`capturedAt` off the payload. **Having the component is not having the disclosure**; P4 is stated as *"the render site must be able to ask the value"* because of this. |
| 6 | **A reusable `Loadable<T>` / `AsyncState<T>` / `Cached<T>`** | **SILENCE — 0 of 6** | Not one of six codebases has a generic union expressing loading/loaded/stale/error with real call sites. `useQueries`: **0** application call sites in all six. Nearest miss: `vibeman` has **four independent copies** of a `{data, timestamp, ttl}` storage envelope (`aiOrchestrator.ts:31`, `api-cache/types.ts:17`, `lru-cache.ts:11`, `analyticsAggregation.ts:58`) — storage, not state. Reported as silence, and it is the second time this corpus has found it (partial-failure §6 clause 11 found the same absence from the failure side). |
| 7 | **A shared cache policy or primitive that nobody uses** | **PHYSICS — doctrine Q3 in three repos** | `vibeman/src/lib/lru-cache.ts` has **zero importers**; `vibeman/src/lib/cache/cache-config.ts` exports a full staleTime/gcTime policy for 8 domains and has **zero importers** while every consumer redefines its own literal; `vibeman/src/lib/api-cache/api-cache.ts` (TTL+LRU+`invalidatePattern`) is consumed by exactly one module. Personas' `staleWhileRevalidate.ts` is the same story with **1** consumer. **Four unused cache abstractions across two repos, and in every case the hand-rolls outnumber them by an order of magnitude.** |
| 8 | **Invalidation is a server-side habit and a client-side afterthought** | **PHYSICS (the ratio, across the fleet)** | Server/lib caches: `personas-cloud` **3:3**, `ascent` **9:9**, `vibeman`'s structured infra all invalidated. Client caches: `personas-web` **3:1**, `vibeman`'s single component-directory cache **1:0** (unbounded, no delete/clear/TTL), `ascent` client **0 caches at all**. Personas' own split is the same shape sharpened: **21 of 61** module fetch caches have a door, and the ones that do cluster in `src/lib` and `src/hooks`. |
| 9 | **A library cache (react-query / SWR)** | **MINORITY (2/5), and its keys are no better** | `vibeman` TanStack, 16 `useQuery`, 0 `useQueries`, **0 `keepPreviousData`/`placeholderData`**; `personas-web` SWR, 7 sites — of which **6 keys are bare global strings holding user-scoped payloads** (`"system-health"`, `"usage"`, …) with only a logout wipe as mitigation. **Adopting a library does not fix P1.** Personas has no query library in `package.json` at all, so its `useQueries: 0` is a genuine absence, not disuse. |
| 10 | **Refusing a warm cache on purpose** | **the instructive counter-example, 1/6** | `brainiac`'s console is a total silence on every question here — no module cache, no dedup, no library — and it is deliberate: `useMemoryDetail.ts` and `useCanonicalDetail.ts` both `setDetail(null)` before refetching on every id change, with the reason written down — *"demoDetail(id) would show an unrelated fabricated memory as if it were this one. Fail honestly instead of substituting."* **A repo with no caching at all independently derived P1 and chose the cost.** A doctrine that said "always warm the remount" would have made that code worse. |

**Physics — keep as doctrine:** clauses 1, 4, 7, 8 (4 and 8 as defects).
**Reported as silence:** clause 6 (*no reusable `Loadable<T>` anywhere; `useQueries` unused
everywhere*).
**Personas is ahead** on clause 3 (transport-level dedup — the only one in six codebases) and
**behind** on clause 5 (staleness disclosure), where the honest reading is that neither repo has it:
one has 5 sites, the other has 7 sites of which 6 measure the wrong thing.

> **The strongest external result is clause 4, and it is not agreement — it is one repo's
> post-mortem.** `ascent/src/lib/cache.ts:43-50` describes this leaf's headline from the far side
> of the fix, in a different language, on a different stack, about a different domain: a key that
> knew the entity but not the *scoring identity*, serving stale scores as current with no
> bulk-invalidation lever. Personas' `spendCache` knows the project but not the *connector*. The
> two are the same sentence. That `ascent` then wrote `:110` — *"Do NOT 'optimize' the fingerprint
> back out"* — is the best evidence in this document that P1 is physics and that the pressure to
> violate it is real and recurring.

## 7. Deviations

Every entry is live on `master` @ `17d059b1f` and was verified by reading the file, by replay, or
both.

### D1 — a cache key that omits the input its value depends on

`src/features/teams/sub_factory/passport/LlmTrackingCell.tsx:20` (`spendCache` keyed by `slug`),
`:29` (the value is a function of `credId`), `:34-37` (the cache branch beats the dependency),
`:58` (the effect *does* depend on `credId`), `:61` (the label is the *new* connector's name).
Full replay in §0.

Reachability: `llm_tracking_credential_id` is per-project and rebindable from the same wall —
`ProjectsLayer` renders `LlmTrackingCell` per project row and the Improve engine writes the binding.
Rebinding a connector without a full reload is the ordinary flow, not a corner case.

**Fix:** two lines. Key on `` `${slug}:${credId}` ``, and drop the `spendCache.set(slug, null)` in
the catch (D5) so a telemetry outage is retried. Better: route it through
`deduplicateKeyedFetch('llmSpend', fetchLlmPinpoints)`, whose key **is** the arguments.

**Then look for the others.** `ByomProviderList.tsx:89` `healthCache` is keyed by provider id but
its value is a connection test through a *credential*; `ApiKeyAuditDrawer.tsx:34` `auditCache` is
keyed by `keyId` but `listApiKeyAudit(keyId, 200)` also takes a limit that is currently a constant;
`SettingsHistoryTab.tsx:21` `historyCache` is keyed by the category filter only. None is wrong
today; all three are one argument away from D1, and none of them derives its key from the call.

### D2 — 40 of 61 module fetch caches have no invalidation and no expiry

Measured by classifying all 71 census matches by hand and then testing each fetch cache's file for
a `.delete`/`.clear` on it, a reset assignment, or a `Date.now()` comparison. **21 have a door; 40
have none.** They are write-once for the process lifetime.

The sharpest, because it is an in-file controlled experiment:
**`src/features/plugins/drive/hooks/useDrive.ts`** holds a component-local `pathCacheRef` (`:294`)
and a module-scoped `driveEntriesCache` (`:71`). `pathCacheRef.current.clear()` appears **7** times,
once in each mutation handler, under the comment at `:647-650` naming the bug it fixes.
`driveEntriesCache` is written at `:322` and read at `:251`, `:253`, `:313` — and **never
deleted, never cleared, never expired**. Replayed in shape by harness B2: a remount after an
out-of-band mutation paints the pre-mutation list on frame 1 (3 rows that no longer exist) and
corrects on frame 2 — and *only for the current path*, because `refresh()` fetches `currentPath`
alone. **The invalidation discipline landed on the cache that dies with the view and skipped the one
that outlives it.** `:313-315` then re-seeds the ref *from* the module cache, partly undoing the
clear.

Others in the same class, each write-once for the session: `useScraperData.ts:30-31`
(configs/datasets, and the file has `save`/`remove`/`run` mutations); `ApiKeysSettings.tsx:83`
`keysCache`; `SettingsHistoryTab.tsx:21`; `ApiKeyAuditDrawer.tsx:34`; `ProjectsLayer.tsx:28`
`FAVICON_CACHE`; `useVaultStatus.ts:17`; `useSavedVaultConfigs.ts:18`;
`useLlmPinpoints.ts:51-54`; `useMonitoringPinpoints.ts:51-53`; `useOverviewData.ts:31-33`;
`useSkillTraceModel.ts:50-51`; `useSkillTreeModel.ts:23-24`; `LifecyclePage.tsx:34-36`;
`CompetitionList.tsx:22-23`; `i18n/useTranslation.ts:42-43`; `customIconStore.ts:48`.

**Fix, per site:** an exported `invalidateX()` beside the cache, called from the writes in the same
file — one function and one call each. Where there are no writes, the declaration comment must say
so.

### D3 — 40 module fetch caches store a bare value, so nothing can ask their age

The same 40 — the overlap is near-total and not coincidental: a cache with no timestamp cannot
have a TTL, which is why its only possible door is a manual `delete`, which is why it usually has
none. The counter-examples show how cheap the field is: `obsidianAvailCache: { at, promise }`
(`api/obsidianBrain/index.ts:119`), `overviewBundleCache` (`{ expiresAt, promise }`,
`api/overview/observability.ts:83`), `configCache` (`{ config, error, ts }`,
`PersonaConfigPanel.tsx:239`), `SUMMARY_CACHE` (`{ summary, at }`, `FleetSessionInsights.tsx:27`),
`cachedSnapshot` (`{ …, at }`, `usePassportData.ts:82-87`).

**And nothing downstream can disclose what it cannot ask.** `StalenessIndicator` — shared,
catalogued, i18n'd, props-only, renders `null` when fresh — has **5 render sites in 2 files**, both
in Overview, and both feed it `pipelineFetchedAt` from the Overview store. **Not one module cache in
the tree renders it**, because not one of the 40 has a timestamp to pass.

**Fix:** `{ value, fetchedAt }` at the declaration, `fetchedAt` threaded to the render site, and
`<StalenessIndicator fetchedAt={…} hasError={…} />` where a surface keeps data through a failed
refresh. One line each once D3 is done, which is why D3 is upstream of the disclosure gap and not
a separate problem.

### D4 — 48 files hand-roll what four shared primitives already do

**71 hand-rolled module caches in 48 files : 12 shared-primitive call sites in 7 files** (§9).
Per primitive: `createTtlValueCache` **1** (`useDataPortability.ts:27`), `createCachedFetch` **1**
(`credentialSlice.ts:33`), `createSWRFetcher` **2** (one file),
`deduplicateFetch`/`deduplicateKeyedFetch` **4** (all Zustand slices). Their invalidation doors
have **zero** callers outside their own tests: `TtlValueCache.delete()`,
`CachedFetchController.invalidate()`, and `clearSWRCache()`. So does
`clearRecipeCache()` (`credentialRecipeRegistry.ts:25-27`). `noAutoDedup` has **zero** callers
outside `tauriInvoke.ts`.

**And it is not for want of a suitable primitive.** `createTtlValueCache`'s docstring is a
description of this deviation, written before it: *"Mirrors the inline `configCache` pattern
(ConfigResolutionPanel) and the `lastPipelineRun` gate (useExecutionDashboardPipeline) as a
reusable primitive — established by the /architect perf scan (per-visit-refetch convention gap)."*
Both named patterns are still inline (`PersonaConfigPanel.tsx:239`,
`useExecutionDashboardPipeline.ts:47`) and **neither migrated**, and 46 more files have since been
written the old way. The one deliberate non-migration in the tree is documented and correct —
`executionSlice.ts:674-681` explains that its freshness timestamp lives in slice state because
`personaSlice.ts:252` reads it, *"a cross-slice contract the module-local primitive can't own."*
**One reasoned refusal, one adoption, and 71 files that never met the question.**

### D5 — a failed read cached as "nothing to show", for the session

`LlmTrackingCell.tsx:51` — `spendCache.set(slug, null)` inside the catch (`:48-53`), so a telemetry 503
becomes a permanent absence with no retry on any later mount. Executed in §0.

`credentialRecipeRegistry.ts:44` (`catch { return null }`) is the *acceptable* form of the same
shape and shows the difference: it does not write the failure into `memoryCache`, so the next
lookup retries.

This is [`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s D1 with a cache
behind it, and the cache is what makes it permanent: that path's 68 sites lose the distinction for
one render, this one loses it for the session. **Fix:** never `set` in a catch; `delete` instead.

### D6 — the shared SWR cache aliases its value across consumers

`staleWhileRevalidate.ts:61-67, :93-97` return `cached.data` by reference on every hit. Executed
(C2): caller 1 mutates, caller 3 sees it. `tauriInvoke.ts:355-367` fixed exactly this at the
transport with a `structuredClone` and a comment naming the failure. **The fix exists in the repo
and has not been carried into the layer above it** — the same class as the convergence oracle's
observation that a fix written in one place does not travel.

**Fix:** `structuredClone` on the hit path of `createSWRFetcher`, with the same fallback-to-shared
guard `tauriInvoke` uses for non-cloneable values.

### D7 — `invalidateSWRCache` misses the in-flight map

`staleWhileRevalidate.ts:105-107` clears `_cache` and not `_inflight`. Executed (C6): an
invalidation that lands while a fetch is in flight is a no-op, and the next caller joins the
pre-invalidation request. Reachable in the only consumer: `useDesignReviews.ts:85-86` and `:108-110`
and `:151-153` and `:180-183` all do `invalidateSWRCache(K); await fetchSWR()`, and `refreshCount`
is invoked from four call paths that overlap on refresh (`:118`), after seeding (`:156`), on mount
(`:170`) and on run completion (`:330`) — the second of which exists precisely because *"seeding is
exactly when the total moves."*

**Fix:** one line — `_inflight.delete(key)` in `invalidateSWRCache`. Note this makes an
invalidation abandon an in-flight request rather than join it, which is the correct trade for a
post-mutation invalidation and should be stated in the docstring.

**And note where the same principle already has a gate, in the other language.**
`process-global-command-state.md`'s `process-global-caches-a-failure` counts
`static X: OnceLock<Result<…>>` in Rust — *never cache a rejection*, P7, enforced. It is this
leaf's nearest **semantic** neighbour and its file overlap with §9's rule is **0%** by
construction, because its roots are `src-tauri/**` and its extension is `.rs`. Two halves of one
principle, gated on one side of the IPC boundary only.

### D8 — half the shared reads are outside the transport dedup's naming contract

`tauriInvoke.ts:161`'s `READ_ONLY_PREFIXES` is `["list_", "get_", "fetch_"]`, matched by
`String.startsWith`. **68 of 135 shared reads are eligible; 67 are not.** Across the whole surface:
**264 of 578 read-shaped commands (45.7%)**, concentrated in `dev_*` (75), `companion_*` (41),
`lab_*` (17), `twin_*` (13). Executed (D7): `read_transcript` and `search_memories`, both real
commands, both called concurrently, produce one round trip each per caller.

Nothing reports this. The frontend wrapper is named `listKpis` — the *read* verb is right there —
and the command it invokes is `dev_tools_list_kpis`.

**Fix, in order:** (1) change `isReadOnlyCommand` to accept an infix `_list_`/`_get_`/`_fetch_` as
well as the prefix, which is a five-line change covering ~200 of the 264 with no rename anywhere;
(2) add the remaining read verbs (`_read_`, `_search_`, `_count_`, `_overview`, `_stats`) after
auditing each for side effects — **and audit, because the current prefix list is safe by
construction and an infix list is not**: `dev_tools_set_static_scan_config` is not a read and
`skill_files_install` is not a read. (3) State the eligibility rule in
[`command-naming-placement`](./command-naming-placement.md), where the naming decision is actually
made.

### D9 — a cache read by a hook whose entity is chosen upstream

`useSkillTraceModel.ts:73-105` resolves its workspace through a three-rung fallback (active
project's workspace → the store's selected workspace → `workspaces[0]`) and then keys the cache on
`workspace?.id` (`:104`). The fallback is deliberate and well-commented, but it means the *same*
`activeProjectId` can resolve to different workspaces across mounts as the store hydrates — and the
cache is consulted with whichever one won this time. Latent rather than live (the guard at `:104`
requires an id match, so a different workspace re-fetches), and worth naming because it is the
shape D1 takes when the key is *derived from a store read inside the hook* rather than passed in —
the residue §4's Q1 note says the type cannot reach.

## 8. Gaps

1. **The gap is discoverability, not capability — and that is a harder gap, because there is
   nothing to build.** Five primitives exist across three directories under three different nouns
   (`src/lib/async/createTtlValueCache`, `src/lib/async/createCachedFetch`,
   `src/lib/utils/staleWhileRevalidate`, `src/lib/utils/deduplicateFetch`, and the invisible one
   inside `tauriInvoke`). Nothing in `CLAUDE.md`, in `.claude/conventions.json`'s `doNotHandRoll`
   list, or in `shared/components/CATALOG.md` mentions any of them — **zero hits for
   `createTtlValueCache`, `createCachedFetch`, `staleWhileRevalidate` or `deduplicateFetch` across
   all three files.** And the one that tried is silently unreachable: `createCachedFetch.ts:2`
   carries a `@catalog` tag, but `scripts/docs/gen-shared-catalog.mjs:30` roots its walk at
   `src/features/shared/components`, so a tag on a `src/lib/async` file produces **no catalog row
   and no error** — a documentation gate that no-ops, which is the §9 failure mode arriving one
   layer up. An author fixing a re-ghosting tab greps for `cache`, finds 71 module-scoped examples
   in the feature tree, and copies one. **The fix is one line in `conventions.json`'s `doNotHandRoll` and
   one row in the reuse doc**, plus §9's ratchet so the count cannot grow while that lands.
   *(Corrects this section's own first draft, which proposed building a sixth primitive; see
   §12.9.)*
2. **`createSWRFetcher` is the one primitive that does need work before adoption.** Its key is
   bound at construction — the returned fetcher takes **no arguments** (verified by execution:
   `f.length === 0`) — so a per-entity cache needs one instance per entity, i.e. a
   `Map<entityId, fetcher>`, which is a hand-rolled cache to avoid a hand-rolled cache. Its hit
   path aliases the cached object (D6) and its invalidation misses in-flight (D7). Either fix those
   three, or fold its LRU cap into `createTtlValueCache` and retire it; two overlapping TTL caches
   in `src/lib` is itself part of Gap 1.
3. **`SWRResult<T>` is declared, exported, and never returned.** It has `isRevalidating`; the
   function returns `{data, fromCache}` instead; **0 references in 4,829 files.** The
   fourth state — *stale, and the refresh failed* — is inexpressible in the return type, so a
   consumer that wants to render it cannot, and the failure is swallowed at `:95`. The fix is to
   return the declared type plus `fetchedAt`, at which point `StalenessIndicator` becomes
   a one-line adoption rather than a plumbing project.
4. **No cache in the repo can be enumerated, inspected, or cleared as a group.** There is no
   registry, no dev-tools panel, no `clearAllCaches()`. On a data reset, a workspace switch, or a
   logout, 40 module caches keep whatever they had. `clearSWRCache()` exists and is called only from
   a test. This is why the fleet-wide answer to "how do I invalidate everything" is a page reload,
   and why `personas-web` needed a `clearUserScopedCaches()` whose own comment records that its
   first version missed most keys.
5. **`StalenessIndicator` cannot be adopted by any module cache, because none has a timestamp** —
   D3. It is props-only and ready; the blocker is upstream. Its `hasError` prop is also a boolean,
   so it can say "the refresh failed" but not "the refresh failed 40 minutes ago and this is from
   before that"; the component reads only `fetchedAt`, which callers stamp on success — so a value
   that has been stale through six failed refreshes looks identical to one stale through none.
6. **Nothing in the type system distinguishes a value that came from a cache.** A component
   receives `DriveEntry[]` whether it came from IPC 5 ms ago or from a module `Map` populated before
   the last nav. `createSWRFetcher` is the only place in the repo that returns provenance
   (`fromCache`), and its single consumer branches on it (`useDesignReviews.ts:167-186`) — which is
   evidence the flag is useful, not that it is available. A `Cached<T> = { value: T; fetchedAt:
   number; fromCache: boolean }` would make it uniform; the convergence sweep found **zero** such
   type in six codebases, so proposing one is an invention and §2 mandates the **shape** instead.
7. **The transport dedup's eligibility is a `const` array with no test and no report.** Adding a
   command with the wrong prefix silently opts it out; there is no fixture asserting that a read
   command is eligible, and `npm run check:contracts` (which does validate command names) does not
   look at this. A four-line assertion in the contract checker — *every command whose name contains
   a read verb must be `isReadOnlyCommand`-eligible or appear in a stated exemption list* — would
   have caught all 264, and is the instrument D8 needs that the census cannot be (it is an
   allowlist-covers-a-set condition, the class `check-csp-hosts.mjs` exists for).

## 9. The missing gate

**The condition:** *a fetched value is stashed in a module-scoped container that outlives every
component, and the container is keyed, expired and invalidated by hand — so nothing checks that the
key covers the fetch, nothing can say how old the value is, and nothing throws it away when the
thing it describes changes.*

**The signal (a proxy, and stated as one):** a module-scoped (column-0) `let`/`var`/`const`
declaration whose name contains `cach`, initialised to a `Map`, `null`, `undefined` or `[]`. This
keys on the shape the condition wears **in this repo**, where Prettier guarantees column 0 means
module scope and the house idiom is `let cachedX` / `const xCache = new Map()`. **An adopting repo
must re-derive its own proxy** — `personas-web` wears the identical condition as
`let cachedResult: PlatformStatsResponse | null = null` (matched), but `vibeman` wears it as
`const store = new APICache<T>()` and `ascent` as a `Map` named `store`/`hintStore`/`negCache`,
none of which this pattern would see.

**The mechanism: a census rule.** The runner exists (`scripts/census/`) and implements the fail-loud
contract, so this path writes no script.

**Where it executes.** Two places, both on the developer's machine: `npm run census:check` is part
of **`npm run check`** (`package.json`), which the agent runs before opening a PR, **and** it is the
`golden-path-census` **pre-push** job in `lefthook.yml:74-75`. It is **not** in `ci.yml` at all,
which is the right side of that trade here: `ci.yml` is red on 10 pre-existing failures, so a gate
that only ran there would run nowhere.

**Why a ratchet on this population is right even though a module cache is sometimes correct.**
[`page-loading`](./page-loading.md) mechanic 4 *prescribes* a module cache, so this rule is
deliberately not "these are all bugs". It is a ratchet on **hand-rolling**: every one of the 61
fetch caches becomes an adoption of a shared primitive once Gap 1 lands, and the count should fall
toward the 10 computation memoisers, which are inert and named below. It does **not** reach zero,
so it must not be deleted at zero — it should be re-baselined when Gap 1 ships and the migration
runs.

**Precision, hand-verified 71/71 on the stated condition.** Every one of the 71 matches was read:
all 71 are a module-scoped cache container declared by hand. On the narrower question *"does this
cache a value that came from outside the module"* the count is **61/71 (86%)**, and the **10**
that do not are listed here on purpose, because separating them requires knowing whether the value
crossed IPC — which no matcher can see: `UseCasesList.tsx:_parseCache`,
`InteractiveSigil.tsx:geometryCache`, `useStructuredQuery.ts:_cachedChips`,
`i18n/routeSections.ts:ROUTE_SECTIONS_CACHE`, `i18n/useTranslation.ts:mergedSectionCache`,
`i18n/englishSections.ts:englishSectionCache`, `i18n/pseudoLocale.ts:cached`,
`errorPipeline.ts:classifyCache`, `formatters.ts:numberFormatCache`,
`matrixBuildSlice.ts:nullScalarsCached`. Ten knowingly-listed inert sites beat a heuristic that
guesses.

**`WeakMap` is excluded by construction, and that is a principled narrowing, not a convenience.** A
`WeakMap` is keyed by object identity, so it can only ever memoise a function of a value you already
hold in memory — it cannot cache a fetch keyed by a string id. Dropping `new WeakMap` from the
alternation removed **6** matches (`connectorNamesCache`, `reviewParseCache`, `signalsCache`,
`stringifyCache`, `SIDEBAR_LABEL_CACHE`, `scalarsCache`) and **all 6 were computation memoisers**,
at zero cost to recall: verified that no fetch cache in the tree is a `WeakMap`.

**Two independent implementations reconcile at 71, and the disagreement was the finding.**
Implementation #1 is a hand-built AST-free inventory that enumerates **all 381** module-scoped
mutable containers in `src/` by walking every file's lines and classifying by declaration keyword
and initialiser; implementation #2 is the census regex run through a standalone matcher that prints
every hit with its line text. They disagreed on the **first draft** of the pattern, which anchored
with `(?:^|\n)` and reported 67/47 — and the disagreement exposed **two** instrument bugs at once:
(a) the leading `\n` made every match *start* on the previous line, so `lineOf()` reported the wrong
line and the printed evidence was a **different file region than the pattern had matched**, the same
class of error the doctrine records for `check-csp-hosts.mjs`; and (b) the name sub-pattern required
at least one character before `cach`, so **every binding literally named `cache`, `cached` or
`cachedDevClone` was missed** — including 11 of the caches this document is about. Switching to `^`
with the `m` flag and a lazy zero-length prefix fixed both. **Neither bug was visible from the
count**: 67 looked as plausible as 71.

**Recall gaps, disclosed:** (1) a **multi-line type annotation** is invisible — the best hand-rolled
cache in the repo, `usePassportData.ts:82-87`, declares `let cachedSnapshot: {` across six lines and
does not match; (2) a cache whose name avoids the word — `staleWhileRevalidate.ts:16 _inflight`,
`useLocalImage.ts:25 inflight`, `usePassportData.ts:92 lastSweepAt`,
`useExecutionDashboardPipeline.ts:47 lastPipelineRun` — is invisible; the `inflight` vocabulary was
tested and **dropped**, because it pulled in 8 boolean re-entrancy guards
(`homeSpineSlice.ts:53-56`, `metricsInFlight` and siblings) that are not caches at all. The word
list is the recall bound exactly as the doctrine predicts, and the misses cluster on the *best*
implementations, which is the uncomfortable direction.

**The positive control partitions the same problem, and its number is the finding.** Pointed at the
**compliant** form over the same roots and extensions — a read routed through one of the repo's
**five** shared caching/dedup doors — it returns **36 matches in 14 files**. Broken down:
**14** are the primitives' own **tests**, **10** are the primitives declaring themselves (6
`noAutoDedup` in `tauriInvoke.ts`, 2 exported invalidators in `staleWhileRevalidate.ts`, and the two
`src/lib/async` factory declarations), and **12 are actual consumer call sites, in 7 files**:
`createTtlValueCache` ×1 (`useDataPortability.ts:27`), `createCachedFetch` ×1
(`credentialSlice.ts:33`), `createSWRFetcher` ×2 + `invalidateSWRCache` ×4 (all in
`useDesignReviews.ts`), `deduplicateFetch`/`deduplicateKeyedFetch` ×4 (four Zustand slices). So the
population partitions **71 hand-rolled (48 files) : 12 shared (7 files)**, and the two must move in
opposite directions. If `hand-rolled-module-cache` falls and the control does **not** rise, a cache
was deleted rather than migrated — and deleting a warm cache is a `page-loading` regression, which
the ratchet would otherwise have recorded as progress.

**The control's tests-outnumber-consumers ratio is itself worth stating: 14 test call sites against
12 production ones.** These primitives are not neglected because they are bad; they are the
best-tested code in this leaf. They are neglected because nothing points at them (Gap 1).

**How it fails loudly if its own precondition is absent:** `floor: 3000` against a live walk of
4,829 `src/**/*.{ts,tsx}` files, so a broken glob or a moved root fails rather than reporting zero;
a rule matching zero files anywhere is a structural failure in the runner; the one `exclude` entry
fails the build if it stops matching a file; and a **drop** without `--update` is fatal.

**What the gate cannot do, stated so nobody trusts it further than it goes:**
- **It cannot see the key.** §0's headline — a `Map` keyed by `slug` whose value depends on
  `credId` — matches this rule as a plain module cache and *nothing about the match says the key is
  wrong*. Key coverage is a **type** (§4: derive the key from the fetch's arguments), not a count.
  That asymmetry is why §4 is written before §9 and why Gap 1 is named the highest-leverage fix.
- **It cannot see absence.** "This cache has no invalidation door" and "this value has no
  timestamp" — D2 and D3, the 40-site findings — are absences, and the census ratchets presence by
  construction. They were measured by a separate pass and are not gateable here.
- **It cannot see the transport contract.** D8's 264 ineligible read commands are a
  set-coverage condition (*does this allowlist cover every read?*), the class that needs a checker
  like `check-csp-hosts.mjs`. §8 Gap 7 specifies it: four lines inside
  `scripts/check-command-contract.mjs`, which already runs in `npm run check`.
- **It cannot tell a good cache from a bad one.** `useTableIntrospection.ts`'s three exemplary
  caches are three matches, exactly like `spendCache`. It counts hand-rolling, which is the thing
  that is uniformly removable; correctness is judged in review.
- **It is defeated by renaming.** `const store = new Map()` is the same cache and is invisible —
  which is precisely how `ascent` and `vibeman` write theirs (§9 portability note).

**Existing rules checked for overlap before proposing this one — file overlap re-measured, not
assumed** (each neighbour's own pattern re-run over `src/` and its file set intersected with this
rule's 48):

| neighbour rule | its matches / files | overlap with my 48 | why it is a different condition |
|---|---:|---:|---|
| `process-global-caches-a-failure` (`process-global-command-state.md`) | 4 / 3 | **0 (0%)** | **the nearest neighbour *semantically* — it is P7, "never cache a rejection", as a `static X: OnceLock<Result<…>>` — and it cannot see a single line of this leaf**, because its roots are `src-tauri/**` and its extension is `.rs`. Same principle, disjoint universe. The two should be read together and cannot be merged. |
| `hand-rolled-stale-token` (`stale-response-guard.md`) | 42 / 36 | **2 (4%)** | counts a hand-rolled latest-wins/`cancelled` token; mine counts a container. Adjacent leaves and the two shared files (`PersonaConfigPanel.tsx`, `useDrive.ts`) match on **different lines** — a cache declaration vs a request-ordering guard. Both being present in one file is the *correct* state, not a duplication. |
| `read-failure-as-empty-value` (`partial-failure-read-envelope.md`) | 68 / 32 | **3 (6%)** | it counts a read whose `.catch` resolves to an empty value; mine counts the container that *keeps* a value. `LlmTrackingCell.tsx` — the live composition (§7 D5) — is in **neither** intersection, because its handler writes to the cache instead of returning a value, so that rule cannot see it. The overlap files (`useSkillTraceModel.ts`, `useSkillTreeModel.ts`, `ProjectsLayer.tsx`) are coincidental co-location. |
| `bindingless-catch-on-io` (`swallowed-error-telemetry.md`) | 128 / 86 | **3 (6%)** | requires `catch {` with no binding; my matches are declarations and carry no catch at all. Disjoint by construction. |
| `widthless-collection-fanout` (`bounded-parallel-fan-out.md`) | 43 / 35 | **3 (6%)** | counts fan-out width at a `Promise.all(xs.map(`; adjacent leaf, orthogonal signal. |
| `unflushable-debounced-write` (`debounced-autosave.md`) | 9 / 7 | **0 (0%)** | a `setTimeout` reaching a durable-write door. Opposite direction (write vs read), opposite mechanism (timer vs container), and — despite §12.5's composition being real — **zero file overlap**, which is itself the point: the two halves of that defect live in different files. |
| `local-empty-state` (`empty-and-demo-states.md`) | 38 / 36 | **0 (0%)** | counts authored empty-state components. |

Each neighbour's own pattern was re-run over `src/` (and `src-tauri/` for the Rust one) and its
file set intersected with mine — not assumed. The largest overlap is **6%**, well under the 83%
that got a previous gate correctly declined.

```json
{
  "id": "hand-rolled-module-cache",
  "goldenPath": "docs/concepts/golden-paths/shared-fetch-cache.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^(?:let|var|const)\\s+[\\w$]{0,40}?(?:[cC]ach|CACH)[\\w$]{0,44}\\s*(?::[^=\\n]{0,200})?=\\s*(?:new\\s+Map\\b|null\\b|undefined\\b|\\[\\s*\\])",
    "flags": "gm",
    "ignoreCommentLines": true,
    "description": "A module-scoped (column-0, therefore module scope under this repo's Prettier config) let/var/const whose name contains 'cach', initialised to a Map, null, undefined or an empty array — a cache container declared BY HAND rather than obtained from one of the repo's FIVE shared caching/dedup primitives. PROXY FOR the stack-free condition: a fetched value is kept in a container that outlives every component, and its key, its expiry and its invalidation are all maintained by hand, so nothing checks that the key covers the fetch, nothing can say how old the value is, and nothing throws it away when the thing it describes changes. WHAT THE MATCH COSTS, executed rather than reasoned: an 18-case replay harness was run under REAL React 19 + @testing-library/react (18/18 pass), driving verbatim transcriptions of src/features/teams/sub_factory/passport/LlmTrackingCell.tsx:20-61 and src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx:34-91 plus the repo's ACTUAL src/lib/utils/staleWhileRevalidate.ts module and a verbatim copy of src/lib/tauriInvoke.ts's auto-dedup, across a simulated remount and an ENTITY SWITCH. spendCache is keyed by project slug while its value is a function of the bound observability credential (credId, not in the key): after rebinding the project to a different connector, the cell renders the literal string 'Helicone staging' above '$412.5/30d' — the OLD connector's 30-day spend, printed under the NEW connector's name — and the new connector is never queried at all (fetches: [{credId:'cred-langfuse'}]). Ground truth for the new connector is $7.25. The same cache does spendCache.set(slug, null) inside its .catch, so ONE 503 produces zero further attempts for the rest of the session, on any mount, for any connector. PRECISION 71/71 on the stated condition, every match hand-read; 61/71 (86%) on the narrower 'this caches a value that came from OUTSIDE the module', and the 10 pure-computation memoisers are LISTED ON PURPOSE in the golden path's section 9 (UseCasesList _parseCache, InteractiveSigil geometryCache, useStructuredQuery _cachedChips, i18n routeSections/mergedSectionCache/englishSections/pseudoLocale, errorPipeline classifyCache, formatters numberFormatCache, matrixBuildSlice nullScalarsCached) because separating them needs to know whether the value crossed IPC, which no matcher has. new WeakMap IS EXCLUDED BY CONSTRUCTION and the narrowing is principled: a WeakMap is keyed by object identity so it can only memoise a function of a value already in memory, never a fetch keyed by an id; dropping it removed 6 matches and all 6 were computation memoisers, at zero cost to recall (verified: no fetch cache in this tree is a WeakMap). TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 71: this regex and a hand-built inventory that enumerates ALL 381 module-scoped mutable containers in src/ by declaration keyword and initialiser. Their DISAGREEMENT was the finding — the first draft anchored with (?:^|\\n), which (a) made every match start on the PREVIOUS line so the printed evidence was a different file region than the pattern had matched, and (b) required a character before 'cach', silently missing EVERY binding literally named cache/cached/cachedDevClone, i.e. 11 of the caches this path is about. It reported 67/47, a number that looked exactly as plausible as the true 71/48. DISCLOSED RECALL GAPS, both structural: (1) a MULTI-LINE type annotation is invisible — the best hand-rolled cache in the repo, usePassportData.ts:82-87 (timestamped, latest-wins-guarded, refreshed on every publish), declares `let cachedSnapshot: {` over six lines and does not match; (2) a cache whose name avoids the word is invisible (staleWhileRevalidate.ts:16 _inflight, useLocalImage.ts:25 inflight, useExecutionDashboardPipeline.ts:47 lastPipelineRun) — the 'inflight' vocabulary was tested and DELIBERATELY DROPPED because it pulled in 8 boolean re-entrancy guards (homeSpineSlice.ts:53-56) that are not caches. THIS RULE IS A RATCHET ON HAND-ROLLING, NOT A CLAIM THAT A MODULE CACHE IS A BUG: docs/concepts/golden-paths/page-loading.md mechanic 4 prescribes one, and 21 of the 61 fetch caches here are well built. What is uniformly removable is the hand-rolling — 71 hand-rolled containers in 48 files against 12 shared-primitive CONSUMER call sites in 7 files, and the destination they should migrate to (src/lib/async/createTtlValueCache.ts:34) is already built, keyed at call time, timestamped, invalidatable and tested, with ONE consumer. IT DOES NOT REACH ZERO (the 10 memoisers stay), so do NOT delete it at zero; re-baseline it after each migration wave. WHAT THIS RULE CANNOT SEE, stated so nobody trusts it further: it CANNOT see the key — the headline defect matches as a plain module cache and nothing about the match says the key is wrong; key coverage is a TYPE (derive the key from the fetch's own arguments, as src/lib/utils/deduplicateFetch.ts:40-54 already does), not a count. It cannot see ABSENCE, so the two 40-site findings (40 of 61 fetch caches have no invalidation door and no timestamp) are unreachable from here by construction. It cannot see that 264 of 578 read-shaped IPC commands fall outside tauriInvoke.ts:161's list_/get_/fetch_ prefix contract and are therefore never deduped — that is an allowlist-covers-a-set condition needing a checker, specified in Gap 7. It cannot tell a good cache from a bad one: useTableIntrospection.ts's three exemplary keyed-and-invalidated caches are three matches, exactly like spendCache. PORTABILITY WARNING, earned from the convergence sweep: personas-web wears this condition as `let cachedResult: PlatformStatsResponse | null = null` (src/hooks/useLiveStats.ts:45 — keyless, never invalidated, invisible to its own logout wipe) which this pattern WOULD match, but vibeman writes `const store = new APICache<T>()` and ascent writes Maps named store/hintStore/negCache, which it would not. An adopting repo must re-key on its own cache idiom. LEGAL DESTINATIONS the pattern leaves unmatched by construction: (1) src/lib/async/createTtlValueCache.ts:34 createTtlValueCache(ttlMs) — the keyed, timestamped, delete()-able module cache this rule's whole population should be, extracted by an /architect scan against this exact convention gap and reached by ONE file; (2) src/lib/async/createCachedFetch.ts:41 createCachedFetch({ttlMs}) when the data lives in a store and only freshness needs tracking; (3) src/lib/utils/deduplicateFetch.ts:40 deduplicateKeyedFetch(prefix, fn), whose key IS the arguments; (4) a Zustand slice with a fetchedAt + TTL gate (9 of 93 store files do this; stores/slices/vault/credentialSlice.ts:32); (5) relying on tauriInvoke.ts's automatic transport dedup, which needs no code at all if the command is named list_/get_/fetch_. Do NOT silence a match by renaming the binding to something without 'cach' (that hides it from the rule without fixing anything) or by moving the same Map into a Zustand slice's module scope — the defect is the hand-maintained key and the missing door, not the file it lives in."
  },
  "exclude": [
    { "path": "src/lib/utils/staleWhileRevalidate.ts", "reason": "the shared primitive itself — its _cache IS the destination this rule routes callers toward" }
  ],
  "baseline": { "files": 48, "matches": 71 },
  "floor": 3000
}
```

```json
{
  "id": "hand-rolled-module-cache-positive-control",
  "goldenPath": "docs/concepts/golden-paths/shared-fetch-cache.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bcreateTtlValueCache\\s*[<(]|\\bcreateCachedFetch\\s*[<(]|\\bcreateSWRFetcher\\s*\\(|\\binvalidateSWRCache\\s*\\(|\\bclearSWRCache\\s*\\(|\\bdeduplicateFetch\\s*\\(|\\bdeduplicateKeyedFetch\\s*\\(|\\bnoAutoDedup\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the COMPLIANT form of the same condition, over the same roots and extensions: a shared read routed through one of the FIVE caching/dedup doors this repo already owns, instead of a hand-rolled module container. The doors: createTtlValueCache (the module-scope keyed value cache with a TTL, get/set/delete/clear, at src/lib/async/createTtlValueCache.ts:34 — the answer for the useState-backed-remount case, whose own docstring says it was 'established by the /architect perf scan (per-visit-refetch convention gap)'); createCachedFetch (in-flight collapse + per-key TTL at src/lib/async/createCachedFetch.ts:41, which records freshness ONLY ON SUCCESS so a failure is never cached, and whose invalidate(key?) clears BOTH the timestamp map and the in-flight map); createSWRFetcher / invalidateSWRCache / clearSWRCache (the TTL + dedup + LRU-500 cache at src/lib/utils/staleWhileRevalidate.ts:55, :105, :110); deduplicateFetch / deduplicateKeyedFetch (in-flight coalescing released in .finally at src/lib/utils/deduplicateFetch.ts:19, :40); and noAutoDedup (the explicit opt-out at src/lib/tauriInvoke.ts:273 — an acknowledgement that the transport already dedupes this read). Returns 36 matches in 14 files against the violating rule's 71 in 48, so the population PARTITIONS and the two counts must move in OPPOSITE directions as the codebase improves. If hand-rolled-module-cache falls while this stays flat, a warm cache was DELETED rather than migrated — which is a page-loading regression (mechanic 4) that the ratchet would otherwise have recorded as progress. THE BREAKDOWN IS ITSELF THE FINDING: of the 36, FOURTEEN are the primitives' own TESTS, TEN are the primitives declaring themselves (6 noAutoDedup in tauriInvoke.ts, 2 exported invalidators in staleWhileRevalidate.ts, 2 factory declarations in src/lib/async), and only TWELVE ARE CONSUMER CALL SITES, IN SEVEN FILES — createTtlValueCache x1 (useDataPortability.ts:27), createCachedFetch x1 (credentialSlice.ts:33), createSWRFetcher x2 + invalidateSWRCache x4 (all in useDesignReviews.ts), deduplicateFetch/deduplicateKeyedFetch x4 (budgetEnforcementSlice.ts:102, eventSlice.ts:25, messageSlice.ts:156, overviewSlice.ts:469). THE TESTS OUTNUMBER THE PRODUCTION CALLERS 14 to 12. Every invalidation door these primitives expose — TtlValueCache.delete(), CachedFetchController.invalidate(), clearSWRCache() — has ZERO callers outside its own test, and noAutoDedup has ZERO callers outside tauriInvoke.ts. This is doctrine Q3 in the wild and the diagnosis is NOT the signature: createTtlValueCache takes its key at CALL time, stamps the timestamp for the caller, exposes delete(key), is tested, and was extracted specifically against the per-visit-refetch gap this rule counts — and it has ONE consumer against 71 hand-rolls. The blocker is discoverability: zero mentions across CLAUDE.md, .claude/conventions.json's doNotHandRoll list, and shared/components/CATALOG.md, and the @catalog tag on createCachedFetch.ts:2 emits no catalog row at all because scripts/docs/gen-shared-catalog.mjs:30 roots its walk at src/features/shared/components. Carries no baseline by construction — a ratchet is monotone-downward and would fail the build every time adoption improved. NOTE it counts only the doors that exist TODAY; if a sixth is added, or createSWRFetcher is folded into createTtlValueCache (see Gap 2), update this pattern or the control will under-report the migration it was built to observe."
  },
  "exclude": [],
  "floor": 3000
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <private scratch registry>`,
never against the shared `rules.json`; the runner reports **71 matches / 48 files** for the rule and
**36 / 14** for the control, over **9,658 file-visits** (2 × 4,829), exit 0 under `--check`.
**Re-extracted from this document and re-run, with identical counts.**

### Why this leaf gets a ratchet and not a type

The corpus ranks a type above a gate, and this is the case where that ranking has already been
tried and did not hold. **The type exists.** `createTtlValueCache(ttlMs)` is the keyed,
timestamped, invalidatable module cache that 61 of these 71 sites should be; `createCachedFetch`
is its store-backed sibling; both are tested; both were extracted by an `/architect` scan that
named this exact convention gap in the docstring. **They have two consumer call sites between
them.** No further type would help — proposing a sixth primitive here is the corpus's own withdrawn
advice — and Q7 says a caller who voluntarily writes `new Map()` cannot be reached by widening
anything.

So the ratchet is the instrument, and the fix it holds the line for is **routing**, not
construction:

- **Two lines of documentation** — a `doNotHandRoll` entry in `.claude/conventions.json` and a row
  in `docs/refactor/shared-component-reuse.md` — which is where a machine-readable convention
  actually reaches an agent in this repo.
- **One three-line fix in `scripts/docs/gen-shared-catalog.mjs`** so a `@catalog` tag outside
  `src/features/shared/components/` is either honoured or *errors*, instead of silently producing
  nothing (`createCachedFetch.ts:2` is a live example).
- **Then migrate**, largest first: `useDrive.ts` (4 caches, 7 misdirected clears),
  `useLlmPinpoints`/`useMonitoringPinpoints`/`useOverviewData`/`useSkillTrace`/`useSkillTree` (the
  five sibling-key hand-rolls, 14 declarations that collapse into 5 `createTtlValueCache` calls),
  then `LlmTrackingCell` (§0, where the migration *is* the bug fix, because the new construction
  site takes the key as an argument).

## 12. Corrections to the brief

1. **`page-loading` §Gaps 3 says "No shared module-scoped-cache primitive." That is false twice
   over, and the second falsification is the sharper one.** `src/lib/utils/staleWhileRevalidate.ts`
   and `src/lib/utils/deduplicateFetch.ts` are two, and **`src/lib/async/createTtlValueCache.ts` is
   a third that is a literal, purpose-built answer to that very sentence** — a module-scope value
   cache, keyed, TTL'd, with `delete()`, tested, whose docstring names `configCache` and
   `lastPipelineRun` (two of the three files `page-loading` §Gaps 3 cites as hand-rolls) as the
   patterns it was extracted from, *"established by the /architect perf scan (per-visit-refetch
   convention gap)."* The gap was found, the primitive was built, and the document recording the
   gap was never updated — so a later reader (this one) re-derived the same conclusion and was
   about to propose building it a second time. **The real finding is Q3, not absence: the primitive
   exists, is correct, and has one consumer.** `page-loading` §Gaps 3 should be replaced with a
   pointer to `src/lib/async/`, and its mechanic-4 prescription should gain the words *"through
   `createTtlValueCache`, keyed by every input the fetch reads."*
2. **"`useQueries` has 0 app call sites and no reusable `Loadable<T>` exists anywhere in six
   repos" — both confirmed, and the first needs a caveat that changes what it means.** `useQueries`
   is 0 here because **there is no query library in `package.json` at all** — no react-query, no
   SWR, no Apollo, no RTK Query. That is an absence of a dependency, not disuse of one, and it is
   the reason the transport-level dedup had to be written (and, per §6 clause 3, is the reason
   Personas is the only repo in the fleet that has it). `vibeman` *does* have TanStack with 16
   `useQuery` sites and still has `useQueries` at 0 and `keepPreviousData` at 0 — so the silence
   survives the caveat. `Loadable<T>`: **0 of 6**, confirmed, and it is the second corpus path to
   find the same absence from the opposite side.
3. **"`tauriInvoke.ts` has a 250 ms auto-dedup that `idempotent-invocation` found the read-command
   naming contract silently depends on" — confirmed, quantified, and the dependency is much larger
   than "silent".** What it dedupes: concurrent identical calls to `list_*`/`get_*`/`fetch_*`,
   keyed on `${cmd}:${stableStringify(args)}`, with 250 ms of grace after settle. What happens when
   two callers want genuinely different results: **executed, D5 — nothing distinguishes them.** Two
   `get_app_setting({key:'theme'})` calls straddling a mutation both receive the pre-mutation value,
   because the key is the *arguments* and the world is not in the arguments. That is correct for a
   read and is the reason the eligibility list is a prefix rather than a verb list — but it means
   the 250 ms window is a real staleness budget, not just a race guard (D3 in the harness: a
   mutation landing between two reads is invisible to the second one). **And the contract misses on
   half the reads**: 68 of 135 shared reads eligible, 264 of 578 read-shaped commands ineligible,
   concentrated in `dev_*` (75) and `companion_*` (41), because the repo names namespaced commands
   with the verb as an *infix*. The five-line infix fix is §7 D8 — with the audit it needs, because
   an infix list is not safe by construction the way a prefix list is.
4. **"68 reads launder failure into an empty value — a cached empty is indistinguishable from a
   cached-nothing" — confirmed, and the composition is worse than additive in a way worth stating
   upward.** [`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s 68 sites lose
   the distinction for **one render**; put a cache behind one and it is lost for **the session**,
   and every later mount inherits it having never issued a request. `LlmTrackingCell.tsx:48-53` is
   the live pair and the replay is in §0. The reconciliation is one clause that fits inside that
   path's existing sentence and this one's §2(f): **never write a failure into a cache; delete
   instead.** And a measurement that surprised me: file-overlap between the two rules is **3 files
   (6%)** and **`LlmTrackingCell.tsx` — the live composition — is in none of them.** That rule's
   signal requires the `.catch` handler to *resolve to* an empty value; this handler
   **writes the empty value into the cache and returns nothing**, so the neighbour's gate cannot
   see the worst instance of its own condition. The composition is real and **neither rule
   counts it**, which is an argument for stating it in prose in both paths rather than trusting
   either ratchet to surface it.
5. **"That cache composed with a cancel-only autosave makes a dropped write invisible — already
   recorded; extend it" — confirmed, and the extension is a general rule the autosave path can
   state without naming a cache.** [`debounced-autosave`](./debounced-autosave.md) §Anti-patterns
   already names the `LifecyclePage.tsx:34-36` pair. The generalisation this leaf can offer: **a
   module cache is a write-back store whose write nobody performs.** Seeding `useState` from a
   module cache makes the cache authoritative for frame 1; if any surface can change that data
   while the view is unmounted — a debounced save that was cancelled, a mutation on another screen,
   an event from the backend — the cache is now the only copy of a fact that is no longer true, and
   the repaint launders it into the UI as current. That is why §2(e) requires an invalidation door
   *called by the writers*, and why D2's `useDrive` case is the same defect without any autosave in
   it: 7 clears of the cache that dies, 0 of the cache that persists.
6. **"whether any cache outlives the entity it describes" — yes, and the answer is structural
   rather than anecdotal.** Not one module cache in the tree is cleared when its entity is deleted.
   `spendCache`, `auditCache`, `historyCache`, `FAVICON_CACHE`, `configCache`, `driveEntriesCache`
   and 34 more retain rows for projects, keys, credentials and files that no longer exist, for the
   process lifetime. Only **one** cache in the repo has an entity-scoped invalidator wired to a
   writer — `clearCacheForCredential` (`useTableIntrospection.ts:47`), called from
   `useSchemaProposal.ts:207` — and it is the one I have named the site to copy. `clearRecipeCache`
   exists with **zero** callers. There is no registry and no `clearAllCaches()` (Gap 4), so the
   fleet-wide answer to "invalidate everything" is a page reload.
7. **"whether a stale cache is ever shown without disclosure (`StalenessIndicator` has 5 render
   sites)" — the count is right and the framing understates it.** All 5 sites are in 2 Overview
   files and all 5 are fed `pipelineFetchedAt` from the Overview store. **Zero module caches render
   it, and none of them could**, because 40 of 61 store a bare value with no timestamp (D3). The
   disclosure gap is not an adoption problem sitting on top of a working substrate; it is
   downstream of a missing field, which is why §2 puts `{value, fetchedAt}` at step (d) and the
   badge at step (h). The convergence sweep sharpened this: `personas-web` has **7** render sites of
   a same-named component and **6 of them pass a component-mount timestamp**, so it discloses more
   surfaces and says something true about fewer.
8. **A correction to my own instrument, offered because the doctrine asks for it — and it is two
   bugs, not one.** The first version of the §9 pattern anchored with `(?:^|\n)`. It reported
   **67 matches in 47 files**, a number I would have baselined. Two things were wrong and neither
   was visible in the count: the leading `\n` put every match's start index on the *previous* line,
   so the line numbers and the printed evidence referred to a **different region of the file than
   the pattern had matched** — the identical failure the doctrine records for
   `check-csp-hosts.mjs`; and the name sub-pattern required at least one character before `cach`,
   so every binding literally named `cache` / `cached` / `cachedDevClone` was silently dropped,
   which is **11 of the caches this document is about**, including the primitive's own `_cache`.
   The hand-built inventory of all 381 module containers is what caught it: it had entries the regex
   did not, and reconciling them found both. **A regex that reports a plausible number about the
   wrong lines is worse than one that reports nothing**, and only a second implementation with a
   different failure mode can tell you which you have.
9. **A second, larger correction to my own work, and the one worth carrying upward: I wrote a whole
   §4 type argument for a primitive that already existed, because I searched for the mechanism
   instead of the concept.** This document's first draft said the repo had **three** shared caching
   primitives and diagnosed the un-adopted one's *signature* as the cause — proposing a new
   `createKeyedSWRFetcher` that derives its key from the fetch's arguments. There are **five**, and
   `src/lib/async/createTtlValueCache.ts` already had that shape, plus a test file, plus a docstring
   naming the exact convention gap it was built to close. **I found it only by chasing an unrelated
   line number** (`credentialSlice.ts:33`, encountered while verifying a citation), an hour after
   the numbers were locked.
   The miss was predictable and the doctrine names its two halves. (a) *A vocabulary-based signal's
   recall is bounded by its author's word list, and the misses cluster on the unusual cases* — my
   inventory keyed on module-scoped bindings whose **names** contain `cach`, and these primitives
   hold their state in `const store = new Map()` and `const inflight = new Map()` **inside a
   factory**, which is correct construction and therefore invisible to a scan for the defect. **The
   best implementations are exactly the ones that do not look like the defect.** (b) *When a clause
   is about a component, search for its NAME as well as its mechanism* — the corpus learned this
   from two composers missing a sibling repo's `StalenessIndicator`. I committed the same error
   **inside one repo**: I never asked "what shared caching primitives exist here", only "where are
   the module caches". A grep for `src/lib/async/` would have answered it in one call.
   The correction improves the document rather than damaging it — the finding is now Q3 (*a correct
   type nobody reaches*) rather than a design critique, and §9 is a ratchet on **routing** rather
   than a placeholder for a build. But the process lesson stands on its own: **before diagnosing why
   a shared answer is unused, enumerate the shared answers.**
10. **Corrected 2026-08-30 — a sixth primitive, missed by the identical mechanism §12.9 already
    diagnosed, one directory over from where that correction was looking.** `src/hooks/utility/data/useModuleSubscription.ts:52`'s
    `createModuleCache` was absent from the FIVE-primitive count in §0 and the table in the section
    above. It holds its state in `const data = new Map()` / `const timestamps = new Map()` **inside
    a factory function**, exactly the construction §12.9(a) names as invisible to a name-based `cach`
    scan — and this leaf's own inventory never widened its search past `src/lib/` to the `src/hooks/`
    tree, so the miss was the same vocabulary-bounded recall problem, applied to a directory instead
    of a word. It is, by the measurements above, the **strongest of the six**: it is the only
    primitive with a `maxSize`/eviction door (the exact gap D2/§7 diagnose in 40 of 61 hand-rolled
    caches), it already has a paired subscription hook so a component re-renders on invalidation
    without a manual re-render kick, and it has three real consumers against the other keyed
    primitives' one apiece. The corrected prescription: **new multi-entry value caches should reach
    for `createModuleCache`, not `createTtlValueCache`** — `createTtlValueCache` stays correct and
    stays put for its existing single-key adopter, but it has no eviction door, so a cache whose key
    space is an entity id (project, credential, file) rather than a fixed literal set is safer built
    on the primitive that bounds itself. §7's Task-3-shaped prescriptions and any future one should
    cite `createModuleCache` first for that population.
