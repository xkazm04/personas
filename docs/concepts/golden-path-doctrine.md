# Golden-path doctrine

What the corpus has *learned about writing itself*. The [contract](./golden-path-contract.md)
says what a golden path must contain; this file says what a composer must know
before writing one.

Every claim here was earned by measurement in a specific path, and the earning
case is named. Nothing in this file is a preference. When a claim was tested and
did not survive, it is listed under [Withdrawn](#withdrawn) rather than deleted —
a refinement that has already been refuted three times will otherwise be
reinvented a fourth.

> **Why this file exists.** Through batch 25 this doctrine lived only in
> orchestrator context and commit messages, and was hand-copied into each
> composer brief. That is one context window away from being lost. Briefs should
> now point here.

---

## 1. Prefer a type over a gate — and the seven qualifications

The corpus ranks "make the bad state unrepresentable" above "add a rule that
counts the bad state". A census rule is a ratchet on a condition you could not
eliminate; it is not the goal.

But the naive form of that advice is wrong often enough that seven
qualifications have been earned against it. Hold every proposed type against all
seven.

**Q1 — A required prop carries only what it actually encodes.**
A closed type constrains exactly what it names and not one thing more.
*Earned:* `successRateSource` is a correctly-closed union (`'measured' | 'proxy'`)
and did not prevent a 100× unit bug, because the unit lived in the number beside
the tag, not in the tag. See [metric-definition](./golden-paths/metric-definition.md).

**Q2 — Requiredness is orthogonal to closedness.**
Making a field required does not close it. These are two different edits and
only one of them is usually the fix.
*Earned:* `timezone: Option<String>` — requiredness changes nothing, because
`None` is legitimate for 23 live rows; closedness (`Option<Tz>`) is the entire
win. See [scheduled-trigger-firing](./golden-paths/scheduled-trigger-firing.md).

**Q3 — A type nobody constructs constrains nothing.**
Count the construction sites before you propose it.
*Earned:* `--max-budget-usd` has one construction site in 963 Rust files and
zero headless calls reach it. See [headless-model-call](./golden-paths/headless-model-call.md).

**Q4 — A type anyone can construct authenticates nothing.**
A newtype with a public field is a comment.
*Earned:* a `UserDb` newtype only helps with a private field; `UserDb(state.db.clone())`
reintroduces the bug it was built to prevent. See [second-database](./golden-paths/second-database.md).

**Q5 — Withholding beats requiring.**
Not giving the caller the dangerous value beats demanding they supply it.
*Earned twice, both as controlled experiments inside one codebase:*
- Three sibling doors on one axis — withhold (`call_claude_text`, no unmetered
  entry point) → 8 callers, 8/8 correct; hand back (`cli_text_with_usage`) →
  2/2 present, both recording the wrong model; permit (`cli_text`) → 0 callers,
  dead code.
- `KanbanBoard.onItemMove(itemId, targetStatus)` omits the index → 1/1 correct.
  `ReferenceBoard.onReorder(toIndex: number)` requires one → 0/1 correct. Making
  `onReorder` required changes nothing; it already was.

**Q6 — Withholding works only when you withhold the *dangerous freedom*, not the answer.**
*Earned:* in drag-reorder the thing to take away is the absolute index into a
possibly-filtered array (`onReorder(movedId, beforeId | null)`), not the identity
of what moved. Withholding the wrong half just breaks the feature.

**Q7 — Withholding a requirement only helps when the requirement was forcing the bad value.**
Where the caller supplies the bad value voluntarily, relaxing the type is inert;
withhold the *construction* instead.
*Earned:* `buildMetadataWithTags(credential, tags)` handed callers the whole
metadata blob to rewrite. Both callers were type-correct and lint-clean and
still lost 3 of 18 keys to a stale read. Widening their input type does nothing.
The fix was deleting the helper. See [entity-draft-editing](./golden-paths/entity-draft-editing.md).

### Where types cannot reach

Before proposing a type, check that it reaches the code. Six places it does
not, all measured:

1. **Inside a SQL string literal.** `engine/platforms/deploy.rs` INSERTed a
   `name` column into `persona_triggers` that has never existed; the compiler
   was content, and GitHub deploy failed 100% of the time. At 6 of 10 INSERT
   sites in that path the column is a word in a string.

   > **Sharpened by [`sql-console`](./golden-paths/sql-console.md): when the
   > untrusted value IS the program, constrain the executor, not the value.**
   > The earning case above had a *developer* write the string, so a test could
   > in principle catch it. Where a user or a model writes it **at runtime**
   > there is nothing to compile and no fixture to assert. Every answer that
   > tries to validate the string is a classifier, and every classifier measured
   > in the fleet has been wrong somewhere. The answers that hold move down a
   > layer — a read-only handle, or a row-level policy where the engine decides.
   > Measured: a `SQLITE_OPEN_READ_ONLY` pool refuses the statements the
   > hand-written classifier lets through, and unlike `PRAGMA query_only = ON`
   > it cannot be switched off from inside a statement.
2. **Through a `OnceLock` or other global.** `db/src/memory_recall.rs:47` hands
   the second pool to nine functions without it passing through a parameter. No
   parameter-level type discipline reaches a value that never crosses a
   parameter.
3. **In an ambient environment variable.** Five Claude spawns inherit
   API-account auth from the environment; four of them run a loop named
   `env_removals` that *looks* like the guard and strips something else.
4. **A thing that was never declared.** Added by
   [`findings-triage-queue`](./golden-paths/findings-triage-queue.md), and it
   generalises the orphan-bindings case. `pending_counts` is six hand-written
   `COUNT(*)` string literals covering **56 of 370 items waiting on a human**;
   the other **314 (84.9%) are in queues nobody registered**, and two of the six
   registered tables have never held a row. **No signature is short a parameter
   and no enum is short a variant** — the failure is nobody calling anything.
   Only an **inventory of what should exist**, compared against the registry,
   finds it. Same shape as an orphan binding, which produces no diff *and* no
   untracked file.
5. **On the far side of a serialization boundary.** Established by
   [`ownership-verification.md`](./golden-paths/ownership-verification.md) §5.4:
   the value a newtype would protect is unforgeable *in Rust* and forgeable *on
   the wire*. The defect is not that a Rust caller can build a `String` — it is
   that a JSON body can. **A newtype at the Rust boundary is downstream of where
   the value entered.** A type authenticates nothing when the untrusted value
   crosses a serialization boundary before the type exists.

   > **Reached independently from the other direction**, hours later, by
   > [`selective-per-item-verdicts`](./golden-paths/selective-per-item-verdicts.md):
   > a discriminated union makes three of its four deviations fail to compile,
   > and **cannot touch the fourth**, because the per-item verdicts live as a
   > JSON array inside a `TEXT` column. Untrusted input arriving and structured
   > output departing hit the same wall. **No type reaches inside a serialized
   > blob** — in either direction, and the storage shape is upstream of every
   > type you could add above it.

6. **Across a build boundary** — established by
   [`compile-time-env-embedding.md`](./golden-paths/compile-time-env-embedding.md).
   Items 1–5 are *spatial*: the value is somewhere the type system does not
   look. This one is **temporal** — by the time the question is asked, the other
   side of the boundary is gone. **The discriminator is whether the mechanism is
   allowed to fail:** `env!` *does* reach across, because an absent variable is a
   compile error. `option_env!` and `import.meta.env` do not, because absence is
   a legal value. Measured: **2 of `build.rs`'s 9 forwarded names actually
   arrived** in the binary.

   > **The same boundary, approached from the other side**, by
   > [`view-state-persistence`](./golden-paths/view-state-persistence.md): a
   > persisted value's **writer and reader are different builds of the same
   > program**. No type spans them, because the type the writer used may no
   > longer exist when the reader runs — and the JSON round trip strips what
   > little was left. Measured: **51 members removed from 18 view-state unions
   > across 156 revisions, 27 of them from unions persisted across restart**,
   > against **five** hand-written repair arms. The compiler is satisfied at both
   > ends and the value in between is from a program that no longer exists.

If the honest answer is that no type reaches the condition, say so. That is a
finding, not a failure — and it is the case where a census rule genuinely earns
its place.

---

## 2. Measurement rules

**Execute, don't read.** The strongest results in the corpus came from running
something, not from reading it:
- Replaying `get_due` verbatim against a copy of the live database showed the
  scheduled-trigger pipeline had not fired in 79 days.
- Counting rows in both stores showed `companion_tours` was created in one
  database and queried from the other, and had never written a row.
- Replaying `ReferenceBoard`'s exact handler showed its drag-to-reorder is a
  no-op for **every** input pair.
- Running the same ordering query under two plans showed duplicate
  `order_index` values give an *unstable* order, not merely a wrong one — it
  changes with the query plan, so it reproduces on one machine and not another.

Copy the live SQLite files before querying them; never open the live file for
write while the app is running. **Then delete your copy when you are done** —
`personas.db` is 331 MB, composers never cleaned up, and the shared scratchpad
reached 20 GB across 176 stale copies on a drive that was 93% full. That is a
throughput limit, not just tidiness: disk is what caps how many composers can
run at once.

**Measure statements, not lines.** The unit for a guard is the statement WITH
its consequent.

**Two independent implementations of every count — and agreement is not
soundness.** Disagreement is a finding. But so is false agreement:
- One composer's two implementations agreed exactly on the headline and were
  **both wrong on the denominator, in opposite directions**.
- Another's two implementations both produced false positives **in the same
  direction** (one matched a lucide icon named `ArrowUpRight`, the other matched
  focus-*navigation* handlers). Hand-verification found the true count was zero.
- A first pass undercounted by 47% because path-qualified Rust types
  (`&crate::UserDbPool`) did not match its pattern.

- A third pair **agreed on the finding and disagreed on where it is.** Both
  reported the same count and the same defect; one placed a site 16 lines early,
  because its `#[cfg(test)]` stripper ate newlines. Agreement on *what* is not
  agreement on *where*, and a `file:line` is the part a reader acts on.

Hand-verify a sample regardless of whether the implementations agree.

**Beware the measurement truncated by its own display limit.** A grep ending in
`head -3` reported "three source comments"; the real count was four.

**A `<child>_count` column is not necessarily a count of `<child>`.** A composer
measured a 41× divergence between a counter and its apparent child table and was
about to publish it; the column is a harvester-supplied *prevalence*, and one
producer writes a lesson's line count into it. Read the writer before treating a
name as a contract.

**Every wrong offset produces a plausible disagreement.** The same composer's
first pass at a daily rollup reported "276 of 500 day-rows disagree" — and
**agreed with its thesis**. Replayed at the machine's real UTC offset: **403 of
403 buckets exact.** The structure it was measuring was the exemplar, not the
deviation. When a bucketed comparison disagrees, suspect the bucket boundary
before the data.

**A `GROUP BY` that omits the scope key the code scopes by produces a false
positive hand-verification cannot find.** Earned by
[`backfill-migration`](./golden-paths/backfill-migration.md), caught before
publication: a query grouped 9 labels as spanning ≥2 contexts and was about to
contradict a code comment. The function is scoped by `project_id`; replayed
*per project* it is **13 of 14 projects at zero and one project at one**. Every
row in the result set was real — the aggregation was the lie, so opening the
rows would have confirmed it. **It also agreed with the composer's thesis**,
which is the condition under which a measurement most needs re-running. Check
that your `GROUP BY` carries every key the code carries.

**Two passes can agree because both searched the same wrong place.** The
"nothing in Personas is chunked" claim was reproduced independently by a
convergence sweep that found the *other* embedding backfill — because both looked
in `migrations/` and the answer lives in `repos/`, behind a cargo feature.
Agreement between two searches over the same scope is not evidence about what
lies outside it.

**Fixing every instance of a defect is not the same as covering every place
that needs the behaviour.** The first is a search over what exists; the second
needs an inventory of what should. They differ exactly on the module that never
had the broken form.

> A pass corrected three byte-identical copies of a credential regex that could
> not match any GitHub token, verified each, and reported the defect closed. A
> composer then found a **fourth** redactor — the Sentry scrubber, the one
> channel that ships data off-device — with **zero** credential patterns at all,
> masking 2 of 26 real token shapes. It survived because the pass searched for
> the broken literal, and this module never had that literal.

When you fix a defect class, enumerate the places that need the behaviour, not
the places that exhibit the bug.

**A false premise whose conclusion survives is the hardest kind to notice.**
`sql-console` §12.3 reported *"all 31 `.route(` registrations enumerated; zero
take a query string"* and concluded the unauthenticated transport does not reach
its leaf. **Four of those handlers take `Query<…>`** — and the module's own
header documents one of them. The conclusion was still right, for a reason the
premise never mentioned: every parameter binds as `?1`/`?2`. So nothing
downstream ever contradicted the false half, and a later brief carried it
forward as fact. **When a measurement supports a conclusion you already believe,
that is when to re-run it** — a wrong number that agrees with you is invisible
until someone measures the same thing for a different reason.

**Agreement between two implementations is not soundness — and composition is
where it breaks.** Beyond the earlier cases, one pair agreed on a total of 34
and disagreed on *membership*, because a consuming regex (`-> Option<[\s\S]{0,700}?serde_json`)
swallowed the next function's signature and merged two matches into one.
Rewriting it as a lookahead made both agree at 34 with an identical per-file
distribution. Check that your matcher composes, not just that it counts.

**A test that runs on one side of a boundary is a third copy, not a check.**
Established by
[`client-rule-mirroring`](./golden-paths/client-rule-mirroring.md), and it
generalises past this repo's Rust/TS split to any two artifacts that are
supposed to agree.

> Both sides of a cross-language "parity" pair ship a `PARITY_FIXTURES` list.
> Each asserts *its own* language's ladder against *its own* fixtures. Edit one
> ladder and its fixtures together and **both suites stay green**. Measured:
> the two mirrors this covers are at 100% agreement over 42 fixtures, 285 live
> rows and 33 helper comparisons — and **their tests could not have told anyone
> if they had drifted.**

The same failure wears a second costume: **codegen guarantees that the two
mirrors agree with each other, not that either agrees with reality.** A tour
anchor generator emits a JSON file and a `.rs` file that are byte-consistent —
and both are **127 anchors behind the tree**, because the generator is wired
into nothing. A green consistency check over two artifacts from one source says
nothing about the source.

Ask of any parity instrument: *what edit would this fail on?* If the answer is
"an edit to only one side", check whether anything actually edits only one side
— and if the fixtures live beside the thing they test, they don't.

**A diff-shaped gate cannot see an absence.** Third earning case, same shape as
the two above: `git diff --quiet` over a generated directory exits **0** for an
untracked file *and* for an orphan — a file whose generator has stopped
projecting it. **29 orphan bindings** accumulated that way, **26 still imported**
and **22 still the declared return type of a live `invoke`**, including one
naming a type that exists nowhere in 963 `.rs` files. Only an **inventory of
what should exist** finds them; the repo's own unused-bindings script *protects*
26 of the 29, because they are imported.

**Test the rival hypothesis before publishing the discriminator.** A composer
proposed *registration* as what separates fresh generated artifacts from stale
ones, then measured the obvious alternative — a compare-before-write guard — and
found it predicts nothing (1 fresh with a dead guard, 1 fresh with a live guard,
1 fresh with `--check`, **1 stale with `--check`**). Registration predicted
**14/14 versus 1/4**. A discriminator that was never raced against its rival is a
correlation with a story attached.

**A vocabulary-based signal's recall is bounded by its author's word list, and
the misses cluster on the unusual cases.** Two implementations agreed on 22
credential-bearing headers; a third returned 20, because its credential-noun
list omitted `connection-string` — and the two it missed were the ones carrying
a database password. The words you forget to list are disproportionately the
interesting ones.

> **And its precision is bounded by the same list, from the other end.** A
> candidate actor-attribution gate scored 4/4 precision on its violations while
> its positive control returned **0 true positives out of 7** — the hits were
> `parsed.username || parsed.password` and `cfg.operator || 'AND'`. The cause
> was that `username` and `operator` went into the actor vocabulary **from
> imagination, before reading the bindings.** Derive the word list from the
> tree — an enum, a schema, a binding — or the same guess distorts both ends of
> the measurement at once.

**Assert the instrument before you trust the result.** A checker that silently
measures nothing passes forever. Give every new instrument a precondition that
fails loudly when it finds nothing to check:

> `scripts/check-csp-hosts.mjs` reported ZERO frontend fetch hosts twice, for
> two unrelated reasons — first because it anchored on the `fetch(...)` argument
> list when the URL is assembled several statements earlier, then because its
> comment stripper ate the URLs (`https://` contains `//`, so a naive
> line-comment regex blanks the rest of every line holding a URL). Without the
> exit-2 guard, both versions would have exited 0 and looked like working gates
> indefinitely.

`scripts/census/check-corpus-integrity.mjs` does the same, exiting 2 if the
spine yields under 200 leaves or the link scan finds none.

**Mechanics on this machine:**
- Regex patterns go in a **file**, never in bash argv and never in a heredoc.
  MSYS mangles backslashes; a heredoc once collapsed `\b` into a literal
  backspace character.
- No variable-length lookbehind — one rule took 73 seconds because of one.
- **Check a pattern for backtracking, not only for precision.** The obvious
  comment-tolerant construction `(?:\s|//[^\n]*)*` is a nested quantifier; it
  hung a 963-file walk past 120 s and had to be killed. A pattern that is
  correct and unrunnable is not a gate.
- `#[cfg(test)]` exclusion must be a **brace-matched range**, never a
  line-number threshold. Test modules are not always at the end of the file.
  And a brace-matched range does not catch everything:
  `dev_tools_backlog_tests.rs` is a test file carrying **no `#[cfg(test)]`
  attribute at all**, so only a filename rule sees it.
- Never print a secret value. Shape, location, count only — not even a prefix.

---

## 3. The severity fact

**Never argue a rule's severity from warning volume.**

`npm run check` runs `eslint src/` with **no `--max-warnings`**, so it exits 0
no matter how many warnings exist. The pre-commit hook runs
`--quiet --max-warnings 99999`, and `--quiet` suppresses warnings *before* they
can be counted. **A warn-level rule enforces nothing at either gate, at any
count, by construction.**

This matters because five golden paths once cited a warning count as the *reason*
to ship a gate at `"error"` ("a warn-level rule is invisible in a sea of
10,086"). That count was stale by roughly 9× and wrong about which rule
dominated. The conclusion survived, but on the mechanism above — which does not
depend on any count.

Warn-level rules still change behaviour, through editor squiggles at authoring
time. That is adoption pressure, not enforcement. Do not confuse the two.

---

## 4. Census rules

The runner is `scripts/census/`. A rule is a **ratchet**, not a verdict.

- **Check the existing rules first** and name the ones you checked. The corpus
  is crowded enough that a reasoned decline is a respectable §9. One gate was
  declined purely for 83% file-overlap with an existing rule; that was correct.
- **The census cannot ratchet a population whose membership varies by machine.**
  Earned by [`tauri-permissions-and-csp`](./golden-paths/tauri-permissions-and-csp.md):
  the natural rule (an unsafe token in any Tauri config) has an anchor of **3
  files on this machine and 1 on a clean clone**, because
  `src-tauri/gen/android/**/tauri.conf.json` exists only after `tauri android`
  ran and is gitignored. The baseline is machine-dependent **and** excluding
  `src-tauri/gen/**` is itself a stale-exclude failure on a clean clone, since
  **0 tracked `.json` files exist there**. No roots/extensions combination sees
  the source config and not its generated copies — they share a basename. When
  the population is not the same on two checkouts, the answer is a different
  instrument, not a cleverer pattern.
- **Enumerate the operators that contain your delimiters.** Two matcher bugs in
  one leaf, each caught only because two implementations disagreed: a TSX generic
  (`<UnifiedTable<PersonaEvent>`) closed a scanner's opening tag at its own `>`,
  reporting 2 of 17 virtualized when the truth was 6; then a census pattern
  missed a real site because `errPct >= 10` puts a `>` outside
  `(?:=>|[^<>])`. If your delimiter is `<` or `>`, list `=>`, `>=`, `<=` before
  you run.
- **A CRLF rewrite makes the merger see zero fenced blocks.** One composer's
  Python edit silently converted its finished document to CRLF; the fence
  extractor then found nothing. Caught before publication. **A lost rule looks
  exactly like a rule nobody wrote** — so after any programmatic edit to a
  finished path, re-extract the fence and confirm the rule count.
- **Measure overlap at the SITE level, against the FINAL pattern.** A composer
  measured its overlap at *file* level against an *intermediate* draft of its own
  pattern, published a clean table, then re-checked and found the finished rule
  matched **the same 5 declarations in the same 2 files with a byte-identical
  baseline** as an existing rule — 100% site overlap, nothing to merge. File
  overlap understates; an intermediate pattern measures a rule you did not ship.
  The decline was worth more than the rule would have been: extending the
  neighbour's verb list by 19 verbs found **zero** additional sites, which
  established that *every* destructive door in the tree already reports a
  quantity and the five that cannot are all exports.
- **A positive control is mandatory.** Same anchors pointed at the COMPLIANT
  form, id ending `-positive-control`, and **no `baseline`** — the merger skips
  controls and `validateRule` rejects one that carries a baseline. A control
  returning ~0 means the pattern is not discriminating on what you think.
  The strongest form **partitions** the anchor's raw matches between violating
  and compliant rather than reporting a ratio.
- **Validate standalone first**, in a scratchpad registry with a filename unique
  to you — sibling composers share the scratchpad directory and have overwritten
  each other's files. Then **re-extract the rule from the finished document and
  re-run it**; the numbers must be identical.
- **A composer must NOT run the full registry** (`npm run census` /
  `census:check`). Validate only your own rule and its control, in your private
  scratch registry. The orchestrator runs the full-registry check on merge —
  which is also the only place a *rise* in someone else's rule is meaningful.

  > Earned 2026-08-16: all three composers of one batch stalled at exactly this
  > step, having written complete documents. The census was healthy; the cause
  > was three agents each running a multi-minute **silent** command
  > concurrently on one machine, starving each other past a 600-second
  > no-output watchdog. The most expensive thing a composer does is the step
  > that proves its rule, and doing it in parallel is what breaks it.
- **The census cannot express "must be zero"** by construction — a rule with
  zero matches fails structurally. If a condition should reach zero, say so, and
  say the rule must be **deleted** at that point rather than baselined at 0.
- **The census cannot assert an ABSENCE**, which is a different and more
  limiting thing. It ratchets a count of something present; it cannot say "no
  code anywhere runs VACUUM", "this allowlist omits the production status", or
  "this gate does not enforce what it names". The retention path's largest
  findings were all absences and none was gateable by counting — they were
  findable only by running the system. When the honest §9 is a decline plus a
  specification for a *different* instrument, write that. `check-csp-hosts.mjs`
  exists because an allowlist-covers-a-set condition cannot live in the census.
- **Refusing to gate is a first-class outcome — with numbers.** Publish the
  violating-vs-compliant counts that made you refuse. Recent refusals:
  22% precision, then 44% after refinement (5 of 9 matches were `#[cfg(test)]`
  fixtures the engine cannot exclude); 2.25× separation at ≤71% precision;
  100% precision but 83% overlap with an existing rule.
  **A gate that fires on correct content is worse than no gate.**
- **A silent drop is a broken matcher more often than fixed code.** The runner
  fails on a drop for that reason. When your own fix causes the drop, confirm
  the fix is real, then ratchet with `npm run census -- --update`.

---

## 5. The convergence oracle

Check prescriptive clauses against the sibling checkouts: `../personas-web`,
`../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`.

### What the oracle is for — settled by the operator, 2026-08-17

**It is a source of raw material, not a validator.** The sweep supplies
candidate practices; **the composer's own engineering judgment adjudicates
them**. That judgment is the reconciliation layer, and it is the point of the
whole exercise — a scan discovers procedures and recurring shapes, and a
composer reading as an expert software engineer forges them into a path whose
quality can exceed what any one author, including this repo's, would have
written unaided.

This is why the corpus keeps producing verdicts like *"the fleet converged on
the disease"* and *"the fleet converged on not having the problem"*. Those are
not failures of the oracle. **They are the reconciliation layer working** — the
sweep counted, and the judgment overruled the count.

Three consequences, and they are binding:

1. **Never defer to a vote.** A clause supported by 5 of 5 siblings and unsound
   on its merits is unsound. Say so, and say that the fleet agrees with it.
2. **A sibling's absence is not evidence a practice is unnecessary.** It may only
   mean one author had not yet needed it there. Report the silence; do not read
   it as a verdict.
3. **"Personas is ahead of the fleet" is the most self-flattering shape a finding
   can take, and it is worth stating anyway** — it identifies where the operator
   has already solved something, which is exactly what a later path should copy
   rather than reinvent. State it *as* self-comparison.

**The concrete illustration is `vibeman`**, and it is a neat one: it is
simultaneously this repo's **ancestor** (dated twice, on two independent leaves)
**and a project tracked inside Personas itself**. Every repo in the cohort was
created by the same person. The app under study tracks its own ancestor as a
row in its own database. There is no outside view available from inside the
cohort — so the outside view has to come from the reading, not from the counting.

**A practice independently reinvented is a *candidate*, not a proof.** One with
no trace elsewhere is **local calibration** and must be labelled a house
convention rather than doctrine — that half stands unchanged, because a silence
does not depend on who wrote the code.

**A check cannot distinguish an absence from a deliberate identity.** Earned by
[`model-and-effort-selection`](./golden-paths/model-and-effort-selection.md),
and it is the sharpest form yet of the symmetry problem
[`translation-completeness`](./golden-paths/translation-completeness.md) named:
when `en = "xhigh"` and `ko = "xhigh"`, the untranslated-string check reads the
match as a **deliberate do-not-translate term** — a brand, a protocol name, a
unit. **A machine token is shaped exactly like a proper noun.** The same
structure appears wherever a checker infers intent from equality: an unchanged
value and an intentionally-identical value are the same bytes. If your
instrument's negative case is "these agree", say what else agreeing looks like.

**A fleet-wide silence can be local to a *component*, not to the fleet.** The
sharpest form of "converged on the disease" yet measured, by
[`entity-picker`](./golden-paths/entity-picker.md): **0 of 3 siblings disclose a
truncation cap in a picker — and 2 of 3 independently wrote "Showing X of Y" or
"+N more" for tables in the same codebases.** Not "nobody knows how"; a solved
problem that did not cross a component boundary. Before reporting a silence,
check whether the same repo answers the same question somewhere else. If it
does, the finding is transfer, not ignorance — and the prescription is different.

**Silence is a valid result and must be reported as silence.** Do not quietly
promote a house convention because the oracle returned nothing. Personas being
*ahead* of all five siblings is a common and reportable outcome — it happened
for the DST-correct schedule evaluator and for unsaved-draft guards.

The oracle has inverted **26+** briefs, including a spine `convergence: converged`
label that held on only one clause of three.

**When a clause is about a component, search for its NAME as well as its
mechanism.** A sweep keyed on how something is implemented is blind to a sibling
that implemented it differently — or, worse, identically under the same name.

> Two composers hours apart swept the same five repos and both concluded
> "Personas is the only repo with a staleness indicator". `personas-web` has one
> **with the same file name**, 7 render sites against our 5, plus i18n and an
> error arm we lacked. Both searched for the mechanism. The same blind spot, from
> the other direction, made a third sweep call per-panel error disclosure
> "local to ascent" because ascent threads a prop where this repo threads a store
> key.

### A sibling that shares your ancestor is not a second opinion

**Before counting a sibling as corroboration, check its lineage.** Two of the
five checkouts contain *ports* of this repo's code. A port agreeing with its
original is one data point wearing two coats, and it inflates the very number
the oracle exists to deflate.

> `external-source-ingestion` reported `personas-cloud/packages/shared/src/prompt.ts`
> as independent reinvention proving that a structural prompt fence is physics.
> It is a port: same numbered docstring, same six tag names, same eleven
> zero-width codepoints, the same magic constant `0x517cc1b7` (a 32-bit
> truncation of ours), canary string identical word-for-word. Removing it takes
> the count from *1 of 5 siblings* to **0 of 4 independent siblings**, and the
> fence ships as strongly-reasoned and externally **untested**.

The tell is textual, not structural: identical comments, identical constants,
identical error strings. Structure can converge; prose cannot.

**Second sighting, on a different leaf:** `vibeman` commit `2953479a` created
that repo's canvas components **fifteen hours before this repo's first commit**,
and shared constants survive here today. Two leaves, two independent datings,
same direction. Treat `vibeman` as an ancestor by default and prove otherwise.

**And establish the DIRECTION, not just the relatedness.** The campaign had been
treating `vibeman` as an independent sibling and, where lineage was suspected,
assuming this repo was the ancestor. [`schema-driven-form`](./golden-paths/schema-driven-form.md)
dated it: **`vibeman`'s repo predates Personas by 7 months and the relevant file
by 18 days — Personas ported *from* vibeman.** That inverts what the borrowed
code is evidence *of*: an ancestor's choice is a constraint this repo inherited,
not a peer's independent agreement, and a defect shared with it may be
imported rather than convergent. Check commit dates on the file, not just the
repo.

**The effective independent cohort is smaller than five, and how much smaller
depends on the leaf.** Two later sweeps measured it:

- A credential sweep found `personas-web`'s rotation overview **self-declares as
  a port** and is demo-gated over a 5-row literal, and `personas-cloud` shares
  this repo's table, column and env-var vocabulary verbatim. **Cohort 5 → 2
  independent**, and 2 of its 3 apparent convergences evaporated.
- A tracing sweep found `personas-cloud` and `personas-web` sharing a
  `@dac-cloud/shared` contract and reported them as **one system**. A later
  sweep found that link **gone**. Both measurements were right when taken.

**Establish the cohort per leaf, at the time you measure it.** "3 of 5" and
"3 of 2" are different findings and only one of them is arithmetic — and the
cohort is not a constant, either across leaves or across weeks.

**A sibling that consumes your decision is not a second opinion; it is a
dependent.** A second exclusion criterion beside lineage, earned by
[`cross-device-pairing`](./golden-paths/cross-device-pairing.md):
`personas-web` was disqualified **twice over** — a port *and* a reader of this
repo's trust store (`supabaseApi.ts:371` selects `synced_devices`). A downstream
consumer agreeing with its upstream is not evidence about the upstream.

The reverse also happens and is worth reporting. A port that *gained* something
the original cannot express is strong evidence for the missing thing — the same
cloud port publishes into `persona_events` **inside a transaction**, which this
engine's `publish(&DbPool)` signature makes impossible at all 33 sites.

### The `convergence` label is not evidence — the field is now closed

**Thirteen spine leaves carrying `convergence: converged` have been tested.
Thirteen failed**, in at least six distinct modes — silence; the fleet converged
on the *disease*; the fleet converged on *not having the problem*; the label's
direction was backwards; the only corroborator was our own port; and, most
recently, **convergence on a weaker substitute with the leaf's own clauses
pointing opposite ways** — 0 of 4 siblings derive a peer identifier from its key
(so the fleet converged on what this repo does *not* do), while on freshness and
revocation reach the fleet is *ahead*. **A single enum field cannot carry a verdict
that splits by clause.** The ninth (`embedded-terminal-session`) failed because **zero of five
siblings has a PTY or an xterm-class emulator at all**, so the label pointed at
a 5/5 silence — and its direction was backwards, since Personas is the only repo
with the problem and owns the fleet's best answer to it.

The tenth failed in a new way, and it is the one to remember: **the fleet
converged on the *disease*.** Not one of six repos can report its own git
commit, branch, build timestamp, or build profile at runtime — zero, six times,
across three languages and four build systems, including two that are handed the
value for free and don't take it. **Perfect agreement on an omission is evidence
that the situation is universal and evidence *against* an answer existing to
adopt.** An oracle that only counts agreement will read that as the strongest
possible confirmation. Always ask what the siblings agreed *to do*.

Treat `convergence` as a hypothesis to test, never a premise to build on. Brief
every composer accordingly. A leaf whose label finally holds is a genuine
finding and should be reported as loudly as another failure.

**`sides` — the ledger, kept honestly.** **Seven** leaves have reported
`sides: "client"` contradicted; **two** have upheld it (`bulk-selection-actions`,
`long-list-rendering`, both with the same structural reason — *the server never
sees the DOM*). `sides: "both"` has been tested once and held. `sides: "server"`
has been tested once and held. So the field is **not noise, and the failure is
specific to one value** — but that value is the majority of the spine, and it is
the one that would narrow a brief away from where the answer lives. **Do not
scope by it; test it and report.**

The finding that earned the rule: the first four contradictions each put the
headline defect, the best artifact **and** the surviving census rule on the
*server*, which made the field look anti-correlated with where the answer lives.
Several of those nodes carry `twoSided: true` in the same object, so the
contradiction is internal to the spine.

**Where it holds, it holds for a structural reason worth knowing.** Both
upholdings are leaves about the DOM — *the server never sees the DOM* — and the
`both` upholding was a leaf whose client half was not derivable from the server
at all. When the label survives, name the mechanism; that is what distinguishes
a correct label from a lucky one.

**And the correction is not always "it was both".** On the seventh contradiction
there was **no client half to report at all** — the exemplar, all nine
deviations, the census rule, its control and its floor were server-side Rust,
and the frontend's only contribution was rendering whatever order the SQL
returned. The one client-side instance of that leaf's condition in the entire
sweep came from a *sibling* repo, so a client-scoped brief would have found that
and nothing at home. Sometimes `"client"` is incomplete; sometimes it is simply
**inverted**. Say which.

**One label has finally held, and it is worth as much as the failures.**
[`ai-draft-preview-apply`](./golden-paths/ai-draft-preview-apply.md) tested
`convergence: mixed` and confirmed it — two clauses physics, one silence. It is
the first spine convergence label the corpus has upheld, and it came from a
composer that measured the cohort first (3 independent, not 5) rather than
taking the count for granted.

### The confound, stated plainly: all six repos have one author

Raised by [`node-canvas`](./golden-paths/node-canvas.md), **confirmed by the
operator the same day**, and it is the most important limitation of this
instrument.

**Independence has always meant independent *code*, never independent
*judgment*.** Every repo in the cohort was written by the same operator. When
five codebases agree, the sweep has observed one engineer reaching for the same
answer five times — which is real evidence about the answer's *ergonomics under
these constraints*, and much weaker evidence that it is physics.

This does not retire the oracle; per the section head above, the oracle was
never the validator. It re-weights the outputs, and the weighting was already
implicit in the next rule:

- **Agreement is the weakest signal the oracle produces.** Report it, label it
  as one author's repeated choice, and do not promote it to physics on count
  alone.
- **A silence stays strong.** Nobody solving a problem five times is evidence
  the problem is hard or unnoticed, whoever wrote the code.
- **Cost, failure and *inversion* stay strongest.** A sibling that tried the
  practice and abandoned it, or that pays a measured price for its absence, is
  evidence no shared authorship explains away.
- **An independent reinvention with a *different mechanism* still counts.** The
  same person choosing the same answer twice is weak; the same person arriving
  at the same *principle* by two different routes, in two languages, having
  forgotten the first, is not nothing — say which one you measured.

**Cost and failure are better evidence than agreement.** The two strongest
oracle results in the corpus were both negative:
- `../personas-cloud` is a *port* of this repo's scheduler, and **the port
  dropped the compare-and-set**. The mechanism that makes the path safe lives in
  a `WHERE` clause that reads like bookkeeping, so a careful engineer did not
  carry it across. That is the corpus's best single argument for a type.
- `../vibeman` kept a database split it had deliberately audited — on size,
  cache and migration-risk grounds, never weighing integrity — and pays for it
  with an integrity trigger bound to a dead table and a watermark-less rollup
  reading 80,817,237 rows for a localhost app.

---

## 6. Check your prescription against your neighbours'

**Two individually-correct golden paths can compose into a defect.** Each is
right about its own leaf and the pair is wrong together.

The measured case: `structured-logging` prescribes moving values out of the
message string and into structured fields. That is correct for queryability —
and on the `error!` path those fields land in `event.tags` and
`event.contexts`, neither of which the Sentry `before_send` scrubber touches,
while the message string it came from *was* scrubbed. Following the
prescription moves data from a redacted field into two unredacted ones.

So before publishing §2, read the prescriptions of the adjacent leaves and ask
what happens to someone who follows both. Name the interaction if you find one.
This has no enforcement — it is a habit the contract does not currently ask
for, added here because a composer offered it upward rather than filing it as a
bug in its own path.

## 7. Corrections are the deliverable

Composers have corrected their brief in nearly every batch, and those
corrections are consistently the most valuable output. A brief is the
orchestrator's hypothesis; the composer's job includes refuting it.

A §12 "corrections to the brief" section is expected. Things briefs have gotten
wrong: the number of databases (three, not two); a `converged` label; which of
two factors dominated a metric (the window, by 6.8×); whether an ordering was a
defect (it was deliberate and correct); and an entire prescription that the
convergence oracle inverted.

The orchestrator has been wrong the same way. It once told a composer a
component was "the mandated chart-panel empty state" when that component has
zero render call sites. Treat a brief's confident assertions as claims to test.

---

## Withdrawn

Tested, refuted, **do not re-assert**:

- **"Convergence measures who audits, not who needs it."** Inverted under
  measurement.
- **"URL-as-store is the structural answer."** Refuted three times. The
  measured relationship is that **the type link predicts drift; the state
  location does not**.
- **"~10,086 lint warnings, almost entirely `no-raw-*-classes`."** Stale by
  ~9× and wrong about the dominator. Re-measure before citing any lint count;
  and see §3 for why the count was never the load-bearing part anyway.
