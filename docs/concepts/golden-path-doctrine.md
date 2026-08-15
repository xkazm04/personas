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

Before proposing a type, check that it reaches the code. Three places it does
not, all measured:

1. **Inside a SQL string literal.** `engine/platforms/deploy.rs` INSERTed a
   `name` column into `persona_triggers` that has never existed; the compiler
   was content, and GitHub deploy failed 100% of the time. At 6 of 10 INSERT
   sites in that path the column is a word in a string.
2. **Through a `OnceLock` or other global.** `db/src/memory_recall.rs:47` hands
   the second pool to nine functions without it passing through a parameter. No
   parameter-level type discipline reaches a value that never crosses a
   parameter.
3. **In an ambient environment variable.** Five Claude spawns inherit
   API-account auth from the environment; four of them run a loop named
   `env_removals` that *looks* like the guard and strips something else.

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
write while the app is running.

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

Hand-verify a sample regardless of whether the implementations agree.

**Beware the measurement truncated by its own display limit.** A grep ending in
`head -3` reported "three source comments"; the real count was four.

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

**Agreement between two implementations is not soundness — and composition is
where it breaks.** Beyond the earlier cases, one pair agreed on a total of 34
and disagreed on *membership*, because a consuming regex (`-> Option<[\s\S]{0,700}?serde_json`)
swallowed the next function's signature and merged two matches into one.
Rewriting it as a lookahead made both agree at 34 with an identical per-file
distribution. Check that your matcher composes, not just that it counts.

**A vocabulary-based signal's recall is bounded by its author's word list, and
the misses cluster on the unusual cases.** Two implementations agreed on 22
credential-bearing headers; a third returned 20, because its credential-noun
list omitted `connection-string` — and the two it missed were the ones carrying
a database password. The words you forget to list are disproportionately the
interesting ones.

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

A practice independently reinvented in a repo with different people and
constraints is **physics**. One with no trace elsewhere is **local calibration**
and must be labelled a house convention, not doctrine.

**Silence is a valid result and must be reported as silence.** Do not quietly
promote a house convention because the oracle returned nothing. Personas being
*ahead* of all five siblings is a common and reportable outcome — it happened
for the DST-correct schedule evaluator and for unsaved-draft guards.

The oracle has inverted **26+** briefs, including a spine `convergence: converged`
label that held on only one clause of three.

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
