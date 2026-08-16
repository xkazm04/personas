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

What still goes to the operator rather than being done silently:

- A change whose first run destroys data (enabling a retention delete, a
  backfill, a schema drop).
- A behavioural change to a security control whose current setting may be
  deliberate (re-listing commands in `PRIVILEGED_COMMANDS`, adding auth to a
  transport the operator uses from a terminal).
- Anything that would break the operator's own workflow.
- Findings about *sibling repos* — report, never edit.

Those are **reported and kept moving past**, not blocked on.

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

2. **Dispatch.** One Opus composer per leaf. Every brief must carry: the
   doctrine pointer, the validation protocol (below), primed leads from adjacent
   paths, the §9 CI calibration, and the standing rules. **Prime each brief with
   what neighbouring paths measured** — the corpus feeding itself leads is what
   makes later batches sharper than earlier ones.

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

## When a composer stalls

It stalls *after* writing its document, at the validation step. The document is
complete. Do not re-dispatch:

1. `node scripts/census/merge-published-rules.mjs <path>` — the merger reads
   blockquoted fences too.
2. Run the full registry yourself; the baselines must reproduce exactly.
3. Commit it like any other.

## Commit messages carry the findings

The corpus's real output is measurements and corrections, and most of them are
too specific for the path document. Put them in the commit: the number, how it
was measured, what it overturned. Name corrections to *your own* briefs and
prior claims explicitly — those have been the campaign's highest-value output.
