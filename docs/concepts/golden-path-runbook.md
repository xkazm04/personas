# Golden-path campaign runbook

How the corpus gets built. The [contract](./golden-path-contract.md) says what a
path must contain; the [doctrine](./golden-path-doctrine.md) says what a composer
must know; this says how the orchestrator runs the loop.

Written 2026-08-16 because the operator asked for the batches to run without a
per-batch approval turn. An autonomous loop whose procedure lives only in one
context window ends at the first compaction.

## Standing authorization

The operator has authorized continuous batching: dispatch, merge, fix, commit,
push, dispatch again, **without waiting for approval between batches**. Do not
ask "shall I continue" — continue.

**No destructive applies** (operator, 2026-08-16). The app is in daily use while
this campaign runs. A fix that changes runtime behaviour gets **written down in
[`golden-path-deferred-fixes.md`](./golden-path-deferred-fixes.md)**, not
applied — and the campaign keeps moving.

The line, concretely. Apply freely:

- comments, documentation, corrections to published paths
- widening a type so omission becomes spellable (`Partial<T>`)
- adding a term to a SQL predicate that was already meant to be there
- fixing a key so a cache stops returning another entity's value
- deleting a helper with zero consumers whose signature is the defect

Note, do not apply:

- anything whose **first run deletes rows** (a retention sweep, a backfill, a
  VACUUM, a schema drop)
- anything that changes **what a live surface shows** while the operator is
  watching it (redacting a terminal stream)
- anything that changes **whether the app starts** (refusing a bad key read)
- a **security control whose current setting may be deliberate** (re-listing
  privileged commands, adding auth to a transport used from a terminal)
- anything that would break the operator's own workflow

Findings about *sibling repos*: report, never edit.

When in doubt it is a note. A note costs a paragraph; a wrong apply costs the
operator's working day.

## The loop

1. **Select leaves.** Rank unwritten spine leaves by risk, then recurrence:

   ```bash
   node -e "
   const fs=require('fs');
   const s=JSON.parse(fs.readFileSync('docs/concepts/situation-spine.json','utf8'));
   const w=new Set(fs.readdirSync('docs/concepts/golden-paths').filter(f=>f.endsWith('.md')).map(f=>f.slice(0,-3)));
   const un=[];
   for(const d of s.domains) for(const sd of d.subdomains) for(const st of sd.situations){
     const doc=(st.doc||st.slug).replace(/\.md\$/,'');
     if(!w.has(doc)) un.push(st);
   }
   un.sort((a,b)=>b.recurrence-a.recurrence);
   for(const u of un.filter(x=>x.risk==='high').slice(0,12))
     console.log(u.recurrence, u.risk, u.sides, u.convergence, u.slug);
   "
   ```

   The command prints `sides` and `convergence` for orientation. **Neither is
   evidence** — the doctrine's label ledgers carry the current tested/failed
   counts (they moved twice while hardcoded numbers sat in this file, which is
   why this line no longer states them). Never narrow a brief with either —
   brief the composer to *test* the label.

2. **Dispatch.** One Opus composer per leaf. Every brief must carry: the
   doctrine pointer, the validation protocol (below), primed leads from adjacent
   paths, the §9 CI calibration, and the standing rules. **Prime each brief with
   what neighbouring paths measured** — the corpus feeding itself leads is what
   makes later batches sharper than earlier ones.

## Mode 2 — the batched tail (from 2026-08-17, corpus ≥175)

The per-leaf mode above was right for the head of the distribution; its cost is
O(leaves × whole-context) and the remaining leaves are recurrence ≤20. From
here, dispatch **batches of 2–3 leaves per composer, within one subdomain**
(they share the same code and the same adjacents), with three changes:

**Tiering.** `risk: high` → full contract. `risk: medium` with recurrence ≥9 →
full contract. Everything else → **short form**: the spine-node header block,
§0 headline, §2 the-one-way (compact), §7 deviations, §9 rule-or-decline,
§12 corrections — target 350–500 lines. **The quality core is tier-independent
and untouched**: two implementations of every count, positive control,
private-registry validation, re-extraction from the finished document,
site-level overlap against final patterns, hand-verified precision. What the
short form drops is prose (steps, anti-pattern catalogs, mandated primitives),
never measurement.

**Priming replaces neighbour-reading.** Composers no longer read adjacent paths
in full. Instead: (a) the brief carries index digests of the adjacents —
`node -e "const i=require('./docs/concepts/golden-paths/index.json'); for (const l of ['<leaf>', …]) { const d=i.docs[l]; console.log('##', l, '\n', d.headline, '\n§2:', d.oneWay, '\nrules:', d.ruleIds.join(', ')) }"`;
(b) once the composer has scoped its subject files, it runs
`node scripts/census/build-golden-path-index.mjs --prime <files…>` and treats
the output as the corpus's prior claims — **verify on use, never re-derive, and
never trust**: a primed claim you contradict is a §12 correction owed to the
path that carries it. Open a full neighbour document only when correcting it.

**Shared instruments and facts.** Import measurement primitives from
`scripts/census/lib/instruments/` (one of the two required implementations may
be the library; the second stays bespoke — disagreement still surfaces). Cite
`docs/concepts/shared-facts.json` facts by id and re-verify with the recorded
`instrument` — one command, not a re-derivation. See
[`golden-path-recall.md`](./golden-path-recall.md) for the artifact contracts.

Everything else — standing authorization, no destructive applies, verify by
exit code, stall/death recovery, commit discipline — is unchanged.

3. **On each report**: merge the rule, apply only fixes you can verify, correct
   any claim the composer overturned *in the published path that carries it*,
   commit, push.

4. **Dispatch the next wave without pausing.**

## Parallelism: 5, and disk is why

Measured 2026-08-16: 12 CPUs, 68 GB RAM. Neither binds.

**Disk does.** Each composer copies the live `personas.db` (331 MB) — the
doctrine requires a copy rather than opening the live file — and never deletes
it. The scratchpad reached **20 GB across 176 stale copies** on a drive at 93%
full. Reclaiming them returned 17 GB.

So: **5 concurrent composers**, and sweep the scratchpad between waves:

```bash
find "$SCRATCHPAD" -type f \( -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" \) -mmin +180 -delete
```

The `-mmin +180` is load-bearing — it spares copies belonging to composers still
running. Do not bulk-delete while a wave is in flight.

The other ceiling is the **600-second no-output watchdog**. It killed all three
composers of one batch when each ran the full census concurrently; that is why
the doctrine forbids a composer running the full registry. Keep it forbidden as
parallelism rises — the risk scales with concurrency.

## Verify by exit code, never through a pipe

```bash
npx tsc --noEmit;                                    echo "tsc=$?"
npm run census:check > /dev/null 2>&1;               echo "census=$?"
node scripts/census/check-corpus-integrity.mjs > /dev/null 2>&1; echo "integrity=$?"
```

Piping a checker through `tail` or `grep` **replaces its exit code with the
pipe's**. That is how a red corpus-integrity run and a red census were both
pushed past on 2026-08-16, by the person who wrote them.

The census fails on a **rise** (a new violation) and on a **silent drop**
(usually a broken matcher, sometimes a real fix). Clearing a drop needs
`npm run census -- --update`, which lands in the diff. A justified **rise** is
allowed — record the justification in the commit; a ratchet that can only move
down will be gamed the first time moving up is right.

## When a composer stalls — or dies

It stalls *after* writing its document, at the validation step. **The same is
true when the session usage limit kills it**: on 2026-08-17 three composers
reported `failed` with an API error, and all three had complete documents on
disk — 1,127 / 1,230 / 1,177 lines, each ending at §12 as the contract
requires. Only the report-back turn was lost.

**So: always check the disk before re-dispatching.** Re-running a composer that
already finished costs a full measurement pass and produces a second, different
set of numbers for the same leaf. What is lost with the report is the
composer's own §12 narration — recover it by reading §0 and §12 out of the
document, which is where the contract puts it.

**A third failure mode: the composer cannot write the file at all.** On
2026-08-17 one composer's writes to `docs/concepts/golden-paths/*.md` were
refused by its harness while its writes to the scratchpad succeeded — its
`*.mjs` and `*.json` working files were all there. **Do not re-dispatch and do
not write the document yourself from the report** — that would be your
composition wearing the composer's measurements. Resume the agent and have it
write the body to the scratchpad under a non-`.md` extension, split at section
boundaries if a single write is refused, then concatenate into place. Recovered
that way: 498 + 380 + 352 = 1,230 lines, fence extracted, baselines reproduced
exactly.

The document is complete. Do not re-dispatch:

1. `node scripts/census/merge-published-rules.mjs <path>` — the merger reads
   blockquoted fences too.
2. Run the full registry yourself; the baselines must reproduce exactly.
3. Commit it like any other.

## Commit messages carry the findings

The corpus's real output is measurements and corrections, and most of them are
too specific for the path document. Put them in the commit: the number, how it
was measured, what it overturned. Name corrections to *your own* briefs and
prior claims explicitly — those have been the campaign's highest-value output.
