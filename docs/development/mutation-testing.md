# Mutation testing: how much the tests actually constrain a module

The repo counts its tests (1,500+ files) and tracks coverage. Neither number says whether a test
would **fail on broken code**. A line can be covered by a test that asserts nothing about it.
A mutation run answers that question directly: it breaks the code on purpose, one site at a time,
and counts how many breaks the tests catch.

## Running it

```bash
# what would be mutated (no tests run, safe anywhere)
node scripts/mutation/run-mutation.mjs src/features/agents/shared/designContext.ts --list

# the run itself: in YOUR OWN worktree, never in a shared checkout
node scripts/mutation/run-mutation.mjs \
  src/features/agents/shared/designContext.ts \
  src/features/agents/shared/__tests__/designContext.test.ts \
  --json mutation-designContext.json
```

The script rewrites the target file in place for each mutant and restores it afterwards, on
Ctrl-C, and on a crash. A sibling session committing from the same checkout in that window would
commit a mutant. Hence the worktree rule; see "Parallel-safety primitives" in `.claude/CLAUDE.md`.

It first runs the tests on the unmutated file and stops with exit 2 if they fail, because a score
over a red suite means nothing. It then prints one line per mutant (`KILLED` / `SURVIVED`), the
score, and every survivor as `file:line:col  from -> to`. **A survivor is a missing assertion**:
the code at that site can change behaviour and no test notices.

## What it mutates, and what it does not

| Operator | Mutation |
|---|---|
| equality | `===` and `!==` swapped |
| logical | `&&` and `\|\|` swapped |
| boundary | `>=`→`>`, `<=`→`<`, `>`→`>=`, `<`→`<=` (space-delimited, so `=>` and generics are never hit) |
| boolean | `true` and `false` swapped |

Sites inside strings and comments are skipped. Regex literals are **not** recognised, so an
operator character inside one can produce a mutant. Such a mutant still changes behaviour, so it
is not counted wrongly; it is just an odd site. The tool deliberately does not delete statements,
empty string literals or rewrite arithmetic. Each of those is a later addition, and the set should
grow only when a real survivor shows it is needed.

There is no npm dependency. Stryker would need a network install and a config file that the gates
would then have to own, and one module does not justify either.

## Which modules to run it on first

Rank by "what breaks if these tests pass on broken code":

1. **`src/features/agents/shared/designContext.ts`**: the parser behind every persona's
   `design_context` blob (nine importers). Until 2026-10-10 it had **no test file of its own**; one
   hook test exercised it incidentally. `__tests__/designContext.test.ts` now pins each branch,
   written against the operator set above (the 80-character title boundary, the LRU capacity and
   refresh, every legacy-key guard). The first run measures whether that design held.
2. **`src/lib/validation/`**: input validation; a flipped guard there ships invalid data silently.
3. **`src/lib/credentials/`**: the renderer side of the vault (see
   [the vault threat model](../security/credential-vault-threat-model.md)).

## Status and the ratchet

**No score is recorded yet.** The harness and the designContext tests were written on 2026-10-10
in a session that could not execute anything, so neither has been run. The first person to run
it should:

1. Run the designContext command above, and fix any test failure first (exit 2).
2. Write each survivor down. Add an assertion that kills it, or record why it is an equivalent
   mutant (a change with no observable effect).
3. Record the result (target, killed/total, date) in this file.

Do not add it to `npm run check` or the census yet. A full run spawns one Vitest process per
mutant (minutes, not seconds), and a ratchet needs a measured baseline that has held across
several runs. Once that holds, the natural home is a weekly job that fails when a module's score
drops below its recorded value, the same two-sided shape as the census.
