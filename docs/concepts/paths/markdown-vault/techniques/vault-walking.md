---
layer: technique
subject: markdown-vault
technique: vault-walking
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Vault walking

Every vault feature — lint, graph, search, mirror, repair — begins the same
way: enumerate the note files. The walk is the filesystem database's query
planner, and it shares physics with directory traversal everywhere (the
general subject belongs to [file-browsing](../../file-browsing/file-browsing.md)).
What earns the vault its own treatment is multiplicity: *many* features walk
*one* tree, each embeds the walk as three small decisions, and hand-rolled
copies drift in exactly those decisions — invisibly, because every copy
still "works".

## The three declared decisions

1. **Depth policy.** Unbounded recursion is correct for a store the
   application curates — until a symlink cycle or pathological nesting makes
   it a hang. A depth cap is a backstop against both, at the price of
   silently ignoring anything nested deeper. Either choice is defensible;
   an *undeclared* choice is not, because the caller inheriting it cannot
   know what "all notes" excludes.
2. **Exclusion policy.** Some subtrees are never records: the editor's own
   metadata directory, trash, version-control internals — the convention
   "dot-prefixed directories are not content" covers them all and every
   walker should agree on it. Hidden *files* are a separate, genuinely
   contestable decision (is a dot-prefixed note a record?), so it is a
   separate option, not folded into the directory rule.
3. **Error policy.** When a subdirectory cannot be read mid-walk, the two
   legitimate answers map to two kinds of consumer, per
   [failure-not-empty-success](../../_laws.md#failure-not-empty-success):
   - **Abort** — for consumers whose output is a claim about the whole
     vault. An integrity report over a partial walk is a false clean; the
     walk must fail loudly instead.
   - **Skip and continue** — for consumers taking a best-effort measurement
     (a size estimate, a progress readout) where a missing corner biases a
     number rather than falsifying a verdict.

   The policy is the *consumer's* property, not the walker's. One walker,
   parameterized; never one policy imposed on all callers because it
   happened to be the first one written.

## Symlinks are boundary holes

A symlinked directory inside the vault can point anywhere — including
outside the vault root, which quietly converts "walk the vault" into "walk
the machine". Three defensible postures, in increasing strictness: follow
with a depth cap as the loop backstop; refuse to descend into symlinked
directories at all; resolve and containment-check each one. A walker states
which it takes, and walkers feeding security-sensitive surfaces (anything
whose output leaves the application or reaches a caller-facing listing) take
one of the stricter two.

## Unify without changing anyone's behavior

The observed lifecycle: five features each hand-roll the walk; months later
the copies disagree about depth, hidden files, and errors, and nobody chose
any of those disagreements. The remedy is extraction — one shared walker
with the three decisions as explicit options — under one non-negotiable
constraint: **porting a caller preserves its observed behavior exactly**.
Each option's default documents which original caller it traces to; a caller
with a divergent policy opts in explicitly rather than being silently
"fixed". Unification that flips a caller's error policy as a side effect has
not removed the drift; it has hidden a behavior change inside a refactor,
which is strictly worse than the drift it cleaned up. If a policy *should*
change, that is its own decision, made on purpose, after the extraction has
made the policies visible enough to argue about.

## Enumerate cheap, read expensive

A walk that returns paths costs directory metadata. A walk that returns
parsed notes costs every byte in the vault, every time. Keep the primitive
cheap — paths out, nothing opened — and let consumers that need bodies read
behind it, so the expensive form can be cached as a unit (with the staleness
honesty that caching a derived view demands) while lint-style consumers that
want fresh reads pay only for what they touch.
