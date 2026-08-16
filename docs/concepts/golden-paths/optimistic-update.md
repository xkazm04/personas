# Golden path — Optimistic update

> Situation node: `client-runtime/mutations-and-editing/optimistic-update` ·
> [situation spine](../situation-spine.md) · recurrence **11** · risk **HIGH** · sides **client** ·
> convergence **diverged** · dimensions **function · resilience · ui · code-quality**.
> Composed 2026-08-16 against `master` @ `17d059b1f`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`, walked four times. Every `await` of a
> function imported from an `@/api/*` module — **1,345** call sites, of which **944** are write-shaped —
> had its **enclosing function body resolved by brace matching over comment-and-string-blanked
> source**, and every state write inside that body was located and classified as *before* or *after*
> the awaited write. Two independent implementations were run and **they disagreed, 21 vs 72, and
> both were wrong** (see [§12.6](#12-corrections-to-the-brief)); the union was hand-classified, every
> candidate opened, to a confirmed population of **34 optimistic writes in 25 files**. Then the census
> engine walked the tree a fourth time for the gate and its control.
>
> **Six scenarios were EXECUTED, not argued.** Three of them drive the **real** `createTeamSlice` from
> `src/stores/slices/pipeline/teamSlice.ts` — not a transcription — mounted in a Zustand-shaped
> harness with the `@/api/pipeline/*` doors mocked and the write held open on a deferred, in a
> composer-private vitest config (nothing written into the repo). The other three are verbatim
> transcriptions of a module-scoped store and a component latch that cannot be imported without their
> React tree. Every number in [§0](#0-the-headline) and every claim in §7 marked *executed* came out of
> that harness. **No `cargo` was run.**
>
> A read-only **copy** of the operator's live `personas.db` (347 MB, 244 tables, copied 2026-08-16
> 18:11 UTC while the app was running; the file was never opened for write; **the copy was deleted at
> the end of composition**) was queried to size the blast radius and to test one specific hypothesis —
> whether an optimistic temp id has ever leaked to the backend. It has not, in any of three tables. The
> database's more important answer is [in §7](#the-measurement-that-could-not-be-made).
>
> **A convergence sweep** ran read-only against all five siblings — `personas-web`, `brainiac`,
> `personas-cloud`, `vibeman`, `ascent`. All five exist and all five were opened. It found the best
> implementation of this leaf in the fleet **outside** this repo, and it found the same abstraction
> built-and-abandoned in two siblings. It also inverted one clause of this document's first draft.
>
> The **Deviations** section is a fix backlog and contains **one live, shipped, session-long lie** and
> **one rollback family that erases other people's writes**, neither previously known.

---

## 0. The headline

**Nine of this repo's rollbacks undo more than they rolled back.** They restore a whole collection
from a copy taken before the write, so anything that landed during the round trip is erased along
with the optimistic change. Executed against the real `teamSlice`:

```
S1  removeTeamMember('m-B')                      [real createTeamSlice, deferred IPC]
    before                 : [ m-A, m-B ]
    after optimistic paint : [ m-A ]
    a concurrent add lands : [ m-A, m-C ]
    the delete IPC REJECTS
    after ROLLBACK         : [ m-A, m-B ]     <-- m-C is gone from the screen. It is in the database.

S2  addTeamMember('pNEW')  — the SAME FILE, 43 lines earlier
    before                 : [ m-A ]
    after optimistic paint : [ m-A, temp ]
    a concurrent add lands : [ m-A, temp, m-C ]
    the insert IPC REJECTS
    after ROLLBACK         : [ m-A, m-C ]     <-- only the temp was removed. m-C survives.
```

**That is a controlled experiment inside one file, by one author, on one concept.** `addTeamMember`
(`teamSlice.ts:203-208`) rolls back by *recomputing from live state* — `state.teamMembers.filter(m => m.id !== tempId)` —
under a comment that says exactly why: *"Rollback atomically — only remove our temp entry, preserve
concurrent changes."* `removeTeamMember` (`:231`), 28 lines later, rolls back by *replacing the
collection*: `set({ teamMembers: prevMembers })`. **Seven of the file's nine optimistic actions use
the second form.** The author knew; the knowledge did not generalise, because nothing in the code
carries it.

The same shape reaches user edits, not just concurrent inserts:

```
S3  updateTeamMemoryImportance('mem-1', 5)       [real createTeamSlice]
    before                 : [ mem-1=1, mem-2=1 ]
    after optimistic paint : [ mem-1=5, mem-2=1 ]
    user drags mem-2's dots: [ mem-1=5, mem-2=4 ]
    the IPC REJECTS
    after ROLLBACK         : [ mem-1=1, mem-2=1 ]  <-- mem-2 snaps back to 1, silently
```

### And four writes never come back at all

```
S5  workspaceStore.deleteWorkspace('w1')         [verbatim, workspaceStore.ts:191-201]
    before                 : [ w1, w2 ]
    after optimistic paint : [ w2 ]
    apiDeleteWorkspace REJECTS
    after the failure      : [ w2 ]   toast: "workspaceStore:delete: DB is locked"
    <-- the workspace is gone from the sidebar and still in SQLite. No restore. No refetch.
```

`.then(refreshWorkspaces).catch(toastCatch(...))` — the refetch is on the **success** branch. And
this store hydrates **once per process**: `ensureHydrated()` (`:117-124`) is guarded by a
`hydrateStarted` boolean set on first read, so `refreshWorkspaces` never runs again on its own. Six
surfaces read `useWorkspaces()` and none of them can repair the lie; the only code in the app that
calls `refreshWorkspaces()` from outside the store is `PatternsPanel.tsx:57`, on mount. **Until the
user happens to open Overview → Patterns, a failed rename, recolor, delete or project-move is the
truth as far as this application is concerned.**

### And one outranks the server permanently

```
S6  CompetitionCard.handleCancel()               [verbatim, CompetitionCard.tsx:140-153]
    before                 : running
    after optimistic paint : cancelled   toast: "Competition cancelled — cleaning up"  (success)
    cancelCompetition REJECTS
    server says            : running
    screen says            : cancelled   <-- the local latch wins for the life of the mount
    toasts                 : [ "…cancelled — cleaning up" (success), "background cleanup issue: …" ]
```

`const effectiveStatus = optimisticCancelled ? 'cancelled' : competition.status` (`:165`). The
`useState` latch is set to `true` and **never set back to `false` anywhere in the file** — grep
returns exactly one write. `onRefresh()` re-reads the row from the backend and the render ignores it.
The success toast fires *before* the write is issued; the error toast that follows says *"background
cleanup issue"*, which describes a tidy-up problem, not a cancellation that did not happen.

### Then look at the denominator

| | count | |
|---|---:|---|
| `await` of an `@/api/*` door in `src/` | **1,345** | brace-matched enclosing function per call site |
| — of which write-shaped | **944** | read-verb prefixes excluded, hand-checked |
| **optimistic writes** (state painted before the write lands) | **34 in 25 files** | **3.6%** of write call sites |
| — the rollback restores something | **28** | |
| — the rollback restores **nothing** | **6** | workspaceStore ×4, `usePresetAdoption.ts:183`, `CompetitionCard.tsx:141` |
| — restores by **replacing a collection with a snapshot** | **9** | erases concurrent writes (S1, S3) |
| — restores by **recomputing from live state** | **5** | the correct form |
| — restores a **scalar** pre-image | **4** | `AutopilotControl`, `UnattendedModeSection`, `SetupPanel`, `CloudSyncCard` |
| — restores a **literal** rather than the pre-image | **2** | `useConversation.ts:126`, `useConnectorStatuses.ts:227` |
| — "restores" by **refetching** the server | **4** | a different value from the one it painted over |
| — compensates in place (marks the optimistic row failed) | **3** | `ChatTab` ×1, `useLifecycle`, `backgroundChatSlice` |
| — the user is told **nothing** | **2** | `useMonitorData.ts:487` (logger only), `useConversation.ts:125` (`silentCatch`) |
| optimistic surfaces that can tell **"you lost a race"** from **"the write failed"** | **1** | `useUnifiedTriage.ts:1071` |

**34 optimistic writes, 6 restore strategies, 1 shared abstraction — used by one surface.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics.** **An optimistic paint is a claim about the future, and you must be able to
> withdraw it.** The moment you show a result the server has not confirmed, you have taken on a debt:
> the code that undoes it must exist *before* the write is issued, in the same place, with access to
> what the screen said a moment ago. A paint whose undo has to be re-derived later will not have one.
> *Warrant: 6 of 34 sites here have no undo at all, and the four largest are in a module-scoped store
> whose only refresh is on the success branch.*
>
> **P2 — physics, and the sharpest clause here.** **Undo YOUR change, not the world.** A rollback that
> restores a saved copy of the whole collection is not a rollback — it is a time machine, and it takes
> every other change with it. Roll back by re-applying the inverse of *your* edit to whatever the
> state now holds, scoped to the row you touched.
> *Warrant: executed inside one file against real store code — the scoped form preserved a concurrent
> insert, the snapshot form erased it; 9 sites in this repo use the erasing form, and a sibling repo
> independently documented the same drift for the count-arithmetic version of it.*
>
> **P3 — physics.** **A failed write and a lost race are different events and the user must be told
> different things.** "Your change did not save, try again" and "somebody already decided this,
> reload" call for opposite actions, and only the second one means the optimistic paint was *right
> about the world and wrong about who did it*. A surface that cannot distinguish them will either
> re-offer an impossible action or discard a real one.
> *Warrant: 1 of 34 sites here distinguishes them, and it exists because unattended overnight agents
> made the second case routine rather than exotic; no sibling repo distinguishes them at all.*
>
> **P4 — physics.** **Never report success before the write returns.** A success toast, a success
> chip, a green tick, a "Saved" label issued on the same tick as the paint is not optimism, it is a
> false statement with a timestamp. The paint can be provisional; the *confirmation* cannot.
> *Warrant: one live site here toasts success and then toasts the failure as a "background cleanup
> issue"; a sibling repo wrote the rule out in a code comment after fixing the same bug on another
> page.*
>
> **P5 — ergonomics, and the one that makes the rest survive.** **The optimistic value must be
> outranked by the server, always.** Hold it as an overlay the next authoritative read clears, never
> as a latch that shadows it. A boolean that says "pretend this is cancelled" and is never set back
> beats every subsequent fetch by construction.
> *Warrant: one live component here latches for the life of the mount; one module-scoped store latches
> for the life of the process.*
>
> **P6 — ergonomics.** **Do not let the surface author the undo.** The paint, the write, the restore
> and the conflict branch are one mechanism with four parts; split across call sites they will be
> assembled differently every time and most of the assemblies will be wrong.
> *Warrant: 6 restore strategies across 34 sites, no two feature areas agreeing unless they share a
> hook — and both siblings that built a reusable optimistic engine ended up with zero importers.*
>
> **P7 — ergonomics.** **Do not optimistically paint what the user cannot re-supply.** Latency is
> worth hiding; input is not. If the paint's rollback would destroy something the user typed and
> cannot retype from the screen, write first and paint after.
> *Warrant: this repo already reverted one such site and wrote the reasoning at the call site — "the
> one failure mode where being optimistic costs data rather than latency."*
>
> **Scale condition.** P1, P4 and P5 are wrong on day one, single user, no concurrency. P2 and P3
> need a second writer — which, in an app with background engines or unattended agents, you already
> have. P6 bites at the third surface.

---

## 1. Trigger

- "It should feel instant — update the UI first and save in the background."
- "Just remove it from the list and call the API."
- "What do I do if the save fails after I've already shown it?"
- "The row came back / the toggle flipped itself back and I don't know why."
- "It said Deleted but it's still there after a reload."
- "Two of us decided the same card — who wins, and what does the loser see?"

**If you are about to write a state update whose value the server has not yet confirmed** — a
`.filter()` that drops a row before the DELETE, a `.map()` that flips a field before the PATCH, a
`setEnabled(!enabled)` above an `await`, a temporary id, a chat bubble before the send — **you are in
this situation.** The single strongest tell: **you are about to save a variable called `prev`.**

### Boundaries with the adjacent leaves

- [**`entity-draft-editing`**](./entity-draft-editing.md) owns the **draft** — the user's un-sent
  input, and which keys go on the wire. This path owns the **result** — the server's not-yet-sent
  answer, painted early. Its rule *"on failure, change nothing: keep the draft"* is the exact
  opposite of this path's *"on failure, change it back"*, and both are right: **a draft must survive a
  failure and an optimistic paint must not.** See §5's last row for the site that confuses them.
- [**`debounced-autosave`**](./debounced-autosave.md) owns **when the write goes out**. This path owns
  **what the screen says while it is out**. Their composition is a live defect here — §7 D2.
- [**`partial-failure-read-envelope`**](./partial-failure-read-envelope.md) owns **a read that half
  answered**. This path owns **a write that has not answered yet**. Its P3 — *emptiness is a claim; a
  failed read cannot make it* — has a mirror here: **presence is a claim, and an unconfirmed write
  cannot make it.**
- [**`stale-response-guard`**](./stale-response-guard.md) owns **an out-of-order response**. This path
  owns the window before any response.
- [**`inline-busy-state`**](./inline-busy-state.md) owns the **spinner on the control the user
  pressed**. It is not this: a per-row busy flag (`setKilling(pid)`, `setPendingMemberId(id)`) asserts
  *"I am working on this"*, which is true. An optimistic paint asserts *"this is done"*, which is not
  yet. **Twenty-two of the 72 candidates this sweep raised were busy flags** and every one of them was
  correct code.

## 2. The one way

**Capture the pre-image, paint the row, issue the write, and undo your own change — not the
collection — if it rejects.** Concretely: bind the *specific* prior value before you paint
(`const prev = mode`, `const prevReadAt = msg.read_at`), never a copy of the whole list; paint by
recomputing from live state (`set(s => ({ rows: s.rows.map(r => r.id === id ? {...r, x} : r) }))`);
issue the write and **await it in the same function that painted**, so the restore is in scope; on
rejection, apply the inverse **scoped to the row you touched**, again recomputing from live state, so
anything that landed during the round trip survives — a `set({ rows: prevRows })` is not a rollback,
it is an undo of everybody. Ask the error whether you *lost a race* rather than *failed to write*: a
lost compare-and-swap means the row is decided and putting it back would re-offer a decision that can
never land, so keep the paint, say so, and re-read. Tell the user either way — a value that changes
back on its own with no message is the worst outcome available, worse than never having been
optimistic. Never issue a success toast, chip or label before the promise resolves; the paint is
provisional and the confirmation is not. And hold the optimistic value where the next authoritative
read overwrites it, never in a `useState` latch the render prefers over the server. Then stop: no
retry ladder, no queue, no offline buffer — an optimistic update is a one-round-trip bet, and if you
need more than that you need a different design.

**If you cannot pay for the undo, do not take the loan.** Where the painted thing is something the
user typed and could not retype off the screen, write first and paint after — `usePendingInteractions.ts:130-146`
reverted exactly that and wrote down why. Optimism buys latency; it must never spend input.

## 3. Mandated primitives

All of these exist today. None needs to be built. Their consumer counts are part of the finding.

| Primitive | What it gives you | Real consumers |
|---|---|---|
| `features/agents/quick-answer/triage/useUnifiedTriage.ts:1017-1094` — `decide` | **the reference optimistic write.** Scoped paint, scoped restore, cursor restore, a conflict branch that does NOT restore, and a toast on both. The only complete one in six repos | 1 surface (the triage deck) |
| `lib/decisions/rowWrites.ts` — `resolveReviewRow` (`:148`), `decideIdeaRow` (`:203`), `decidePracticeRow` (`:235`), `decidePolicyProposalRow` (`:346`), `decideEvolutionProposalRow` (`:398`) | **one write door per decidable row, and every one REJECTS on failure.** Its own docstring is this leaf's thesis: *"Optimistic UI is fine — it is only honest if the rejection can undo it"* (`:16`) | 5 surfaces |
| `lib/decisions/rowWrites.ts:98` — `isDecisionConflict(error)` | **the P3 discriminator.** Recognises the compare-and-swap-loser message of **five** different row types against **three** tables, pinned verbatim by `__tests__/rowWrites.test.ts` so a reworded Rust `format!` fails there rather than degrading into a generic error | 3 |
| `stores/slices/pipeline/teamSlice.ts:203-208` (and `:265-270`) | **the scoped rollback, with its rationale in the comment.** `state.teamMembers.filter(m => m.id !== tempId)` inside a guard that also checks the user has not switched entity mid-flight | 2 (both in this file) |
| `stores/slices/overview/messageSlice.ts:70-116` | **field-scoped restore**: it saves `prevReadAt` — one field of one row — not the message list, and keeps a `_pendingReadIds` set so a second click cannot double-count | 1 |
| `stores/storeTypes.ts:100` — `reportError(err, fallback, set, opts)` | Sentry + store `error` + a de-duplicated toast in one call. It **returns** a string and never throws — which is why five store actions had to add an explicit `throw` beside it (`overviewSlice.ts:465`, `:530`, `devToolsTriageSlice.ts:219`, `:237`) so an optimistic caller could see the failure at all | ~90 |
| `features/agents/sub_editor/libs/useDebouncedSaveGroup.ts:36-45` | the only write-ordering guard in the repo — relevant when two optimistic writes to the same row can overlap | 2 |

**Do NOT build:** a `useState` mirror of a server field that the render prefers over the server
(§7 D3); a `.then(refresh).catch(report)` chain where the refresh is on the success branch (§7 D1); a
rollback that assigns a saved collection back to a store key (§7 D4, 9 sites); a success toast above
an un-awaited write (§7 D3); a second "did it work" boolean beside the paint.

## 4. Steps

1. **Decide whether to be optimistic at all.** If the write is slow *and* the painted value is
   re-derivable from the screen, yes. If the painted value is the user's input, no — write first
   (P7). If the surface is a queue somebody else also works, you additionally owe step 7.
2. **Bind the pre-image, narrowly.** `const prev = mode`, `const prevReadAt = msg.read_at`,
   `const tempId = …`. **Never `const prevRows = get().rows`.** The pre-image you want is the smallest
   thing that lets you write the inverse — usually one field or one id.
3. **Paint by recomputing from live state.** `set(s => ({ rows: s.rows.map(…) }))`, not
   `set({ rows: nextRows })` built from a copy captured earlier. This matters for the paint as well as
   the rollback: a paint computed from a stale copy has the same defect one step earlier.
4. **Issue the write and `await` it in the function that painted.** A `.then().catch()` chain works
   too — but the `.catch` must contain the restore, not a reporter. If the write is dispatched from a
   different function than the paint, you have already lost: nothing in the failure path knows what
   the screen said.
5. **On rejection, apply the inverse, scoped.** Recompute from live state again. Remove *your* temp id;
   flip *your* field back; add *your* row back. Everything that arrived in between must survive.
6. **Tell the user.** `toastCatch` or `reportError`. A silent revert is the failure mode users
   describe as "the app is haunted".
7. **Ask whether you lost a race.** `if (isDecisionConflict(error))` — if so, **do not restore**: the
   row really is decided, just not by you. Say so, re-read the queue, and keep the paint.
8. **Let the server win.** Reconcile to the response on success (`teamSlice.ts:198` replaces the temp
   with the real row; `alertSlice.ts:332-341` adopts the backend's toggled entity). Never leave a
   local flag that the render prefers over the next fetch.
9. **And then stop.** No retry loop, no offline queue, no second optimistic layer on top. One round
   trip, one paint, one undo.

### Can the type make the wrong call impossible? — asked before §9

**Partly, and the part it reaches is the one that is currently loose.**

The dangerous state is *"the screen asserts something the server has not confirmed, and nothing is
obliged to withdraw it."* The obligation is the thing to type. Held against the seven qualifications
([doctrine §1](../golden-path-doctrine.md#1-prefer-a-type-over-a-gate--and-the-seven-qualifications)):

1. **Q1 — a required prop carries only what it encodes.** A required `onRollback` would encode *"a
   rollback function was supplied"*, not *"it undoes the right thing"*. Decisive here: **all nine of
   the erasing rollbacks in §7 D4 would satisfy such a prop.** The defect this leaf is worst at is not
   a missing rollback, it is a *wrong* one, and no signature distinguishes
   `set({rows: prevRows})` from `set(s => ({rows: s.rows.filter(…)}))`.
2. **Q2 — requiredness is orthogonal to closedness.** The closedness win is real and it is on the
   *rollback's input*: a rollback that can only receive `(liveState, myPatch)` and never a captured
   collection cannot express the erasing form. That is withheld construction (Q6), not requiredness.
3. **Q3 — a type nobody constructs constrains nothing.** `rowWrites`'s doors are constructed by 5
   surfaces and `isDecisionConflict` by 3 — enough to be worth typing. `useUnifiedTriage.decide` has
   **1** consumer, so changing *its* signature reaches one surface. The binding constraint on this
   leaf is adoption, as it was for both sibling paths.
4. **Q4 — a type anyone can construct authenticates nothing.** `set` is a Zustand setter and
   `useState` is a React global. Nothing prevents a developer from painting.
5. **Q5 — withholding beats requiring.** The dangerous freedom is **holding a copy of the collection**,
   and it *can* be withheld: an `applyOptimistic(id, patch)` that returns an `undo()` closure never
   hands the caller a snapshot to restore from, because it computes the inverse itself. Two sites
   already do the equivalent by hand (`teamSlice.ts:203`, `:265`) and both are the correct ones.
6. **Q6 — withhold the dangerous freedom, not the answer.** The answer is *what changed* — the id and
   the patch. The dangerous freedom is *what to put back*. Take the second, keep the first.
7. **Q7 — withholding a requirement only helps when the requirement forced the bad value.** Nothing
   *requires* a snapshot; developers reach for one because it is the obvious spelling of "undo".
   Relaxing a type is inert. **The fix is to make the correct construction the one that is easier to
   reach** — the same conclusion `debounced-autosave` arrived at for timers.

**Where a type cannot reach.** Nothing in the type system can see that `optimisticCancelled ?
'cancelled' : competition.status` prefers a local boolean over a server field (§7 D3) — that is a
render expression, and both branches are `string`. Nothing can see that a `.catch` handler reports
without restoring. And nothing can see that a store hydrates once per process. Those are §9's
territory, and §9 can only reach one of them.

**The one type that does pay** is on the *conflict* axis, and it is cheap:
`isDecisionConflict(error): boolean` is a predicate over a message, which means every caller must
remember to ask. Making the doors reject with a **discriminated error** —
`{ kind: 'conflict', winner } | { kind: 'failed', message }` — turns "did you ask?" into a compile
question at the 5 call sites that already route through `rowWrites`. That is a closedness fix (Q2) on
a type that is genuinely constructed (Q3), and it is the difference between P3 being available and P3
being reliable.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`const prevRows = get().rows` … `catch { set({ rows: prevRows }) }`** | It is not a rollback, it is an undo of everybody. Executed against the real slice: a concurrent insert that landed during the round trip **disappears from the screen while existing in the database**, and a second edit the user made **snaps back with no message**. 9 sites. §7 D4. |
| **`commit(optimistic); void write().then(refresh).catch(report)`** | The refetch is on the success branch and the failure branch only reports. The paint is now permanent. 4 sites in one module-scoped store whose hydration is a one-way latch, so nothing else re-reads it either. §7 D1. |
| **`const [optimisticX, setOptimisticX] = useState(false)` read as `optimisticX ? A : server.x`** | The local value outranks every subsequent fetch. Set once, never cleared, it is not an optimistic update — it is a private fork of the server's state that wins forever. §7 D3. |
| **`addToast('Done', 'success')` above the write** | A confirmation the write has not earned. When it then fails, the second toast has to contradict the first, and the one live instance calls the contradiction a *"background cleanup issue"*. §7 D3. |
| **Reverting to a literal instead of the pre-image** | `catch { setLink(null) }` is only correct when the row was empty before. Re-linking a connector from credential A to B and failing shows **unlinked**, though A is still linked server-side. `useConnectorStatuses.ts:227`. |
| **Rolling a *count* back with `+ 1` while rolling the *row* back from a snapshot** | Two different clocks. If any refetch landed between the paint and the failure the count is now off by one, permanently, until the next read. `messageSlice.ts:104-113`. A sibling repo hit the identical drift with `+=` and documented it. |
| **Treating every rejection as "the write failed"** | A lost compare-and-swap means the row IS decided. Restoring it re-offers a decision that can never land, and the reviewer loses the race twice. One surface in this repo asks; the other four that write through the same doors do not. §7 D5. |
| **`.catch(toastCatch('ctx'))` as the whole failure handler of an optimistic write** | A bare reporter takes only the error. It has no access to the pre-image and it does not refetch — **it is structurally incapable of undoing the paint**, and it looks like handling. |
| **Painting the user's input optimistically** | Rolling back destroys something they cannot retype from the screen. `usePendingInteractions.ts:130-146` reverted exactly this and left the reasoning: *"the one failure mode where being optimistic costs data rather than latency."* |
| **A silent revert** | `logger.error` + a value that changes back on its own. Two sites. This is the outcome users report as a bug in the *display*, so it is also the one least likely to be diagnosed. |
| **Confusing this path with `entity-draft-editing`** | Its rule is *on failure, keep the draft*; this one's is *on failure, put it back*. A surface that keeps an optimistic paint on failure is asserting a fact; a surface that discards a draft on failure is destroying input. **Ask whether the value came from the user or from the server.** |

## 6. Evidence

**The one site to copy: `src/features/agents/quick-answer/triage/useUnifiedTriage.ts:1017-1094` — `decide`.**

```ts
      advanceCursor(item.id);                                   // :1025 move the read head first
      …
      setResolved((prev) => new Set(prev).add(item.id));        // :1039 optimistic, SCOPED to one id
      try {
        await routeDecision(decision, ports);                   // :1041 the write, awaited here
        …
      } catch (error) {
        if (isDecisionConflict(error)) {                        // :1071 a LOST RACE is not a failure
          journal(decision, true);                              //       spent-and-lost, recorded
          arm(null); sayConflict(); refreshSources();           //       tell, re-read, KEEP the paint
          return;
        }
        setResolved((prev) => { const next = new Set(prev);     // :1085 undo MY id, from live state
                                next.delete(item.id); return next; });
        setCursorId(item.id);                                   // :1090 and put the reviewer back on it
        arm(null);
        toastCatch('Could not record that decision')(error);
      }
```

Six decisions worth copying: (1) the paint is a **set membership keyed by id**, so the undo is
`delete` and cannot touch another row; (2) the write is awaited **in the function that painted**, so
the restore is in scope; (3) the conflict branch **deliberately does not restore**, with the reason
written down — *"Putting the card back would be a lie and would re-offer a decision that can never
land"*; (4) the *cursor* is restored too, because the optimistic paint moved more than one piece of
state and a partial undo is its own bug; (5) the failure toasts and the conflict toasts say different
things; (6) the docstring states the trade the whole leaf turns on:

> *"Writes resolve optimistically — the row leaves the queue as soon as the write is issued — because
> a triage surface that pauses after each decision is a triage surface nobody finishes. The safety
> that makes that honest is the restore below."* — `:1011-1015`

**And read its write doors with it.** `lib/decisions/rowWrites.ts` exists because fifteen call sites
used to write verdicts with their own error handling and *"four swallowed the failure outright"*
(`:1-30`). Its second rule — every door carries the status the caller **saw**, which the backend turns
into a compare-and-swap — is what makes P3 expressible at all. It is also the only place in six
codebases where "you lost a race" is a first-class value rather than a string nobody parses.

Other sites worth reading, each for one thing:

| Site | What it gets right |
|---|---|
| `stores/slices/pipeline/teamSlice.ts:203-208` | the scoped rollback **and** an entity-switch guard, with the comment naming both hazards |
| `stores/slices/overview/messageSlice.ts:74-116` | a **field**-scoped pre-image (`prevReadAt`), plus `_pendingReadIds` so a double click cannot double-count |
| `stores/slices/vault/credentialSlice.ts:220-250` | the **tentative** alternative to optimism: `pendingDeleteCredentialIds` greys the row out, and the removal happens on success. Nothing is ever asserted that is not true |
| `features/plugins/obsidian-brain/sub_setup/SetupPanel.tsx:91-104` | the smallest correct instance in the tree — 12 lines, `setMirrorConfig(next) // optimistic`, `catch { setMirrorConfig(mirrorConfig); addToast(…) }` |
| `features/teams/sub_kpis/AutopilotControl.tsx:56-68` and `features/triggers/sub_triggers/UnattendedModeSection.tsx:48-60` | the scalar pre-image (`const prev = mode`), independently written twice with identical shape |
| `features/vault/sub_databases/tabs/ChatTab.tsx:137-147` | **compensation in place** — the optimistic assistant bubble is not deleted, it is marked `status: 'failed'` with the real error. The paint stays and becomes honest |
| `features/agents/quick-answer/usePendingInteractions.ts:128-152` | the decision **not** to be optimistic, with the reasoning: the paint would have destroyed the user's typed answers |
| `stores/slices/overview/overviewSlice.ts:449-466`, `:517-531` | two store doors that had to grow an explicit `throw` beside `reportError` *"so an optimistic caller can put the row back"* — the clearest statement anywhere of what a swallowing door costs |

### Convergence — five sibling repos

Read-only sweep of `personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent`. All five exist;
all five were opened; none was modified. The sweep searched by **name** (`optimistic`, `rollback`,
`revert`, `snapshot`, `previous`, `onMutate`, `setQueryData`, `useOptimistic`) **and** by mechanism
(state written before an awaited write), per [doctrine §5](../golden-path-doctrine.md#5-the-convergence-oracle).

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **The optimistic write gets hand-rolled rather than taken from a library** | **PHYSICS (4 of 6)** | `ascent` (React 19, no mutation lib), `personas-web` (has `swr`, does not use its mutate-optimistic), `brainiac` (none), Personas (zustand only). Only `vibeman` uses a library's machinery — `@tanstack/react-query`'s `onMutate`, 3 textbook cycles in `src/lib/queries/useMutations.ts:28,91,144`. **`useOptimistic` (React 19): 1 call site in six repos.** |
| 2 | **⚠ Rollback restores the exact prior value** | **PHYSICS as the CORRECT form (2 of 6) — and Personas is behind** | **`ascent` is the reference implementation in the whole fleet**: `src/components/connect/useInstallationRepos.ts:205-262` patches optimistically, POSTs, and restores the *exact* prior value on a non-2xx **or** a network error, with an inline user-visible error. Its rollback transforms are **pure functions in a separate file** (`watchState.ts:29,36,73`) and **unit-tested** (`watchState.test.ts`) — the only repo where rollback logic has tests at all. `vibeman/src/stores/contextStore.ts:593,615,618` snapshots `previousContexts`, restores it, and `toast.error`s. |
| 3 | **⚠ Out-of-order optimistic writes are guarded** | **LOCAL to `ascent` (1 of 6)** | `useInstallationRepos.ts:197-203` keeps a per-row monotonic sequence (`watchSeq`/`scheduleSeq`) checked at `:220,:226,:252,:258`, so a stale response cannot clobber a newer intent. **Nothing in Personas guards the order of two optimistic writes to the same row.** Its comment names the stake better than this document could: *"Success theater (showing a state the server never saved) on watch/schedule means scans silently never run."* |
| 4 | **⚠ A rollback computed by inverse ARITHMETIC drifts** | **PHYSICS as a DEFECT (2 of 6), independently** | `personas-web/src/components/sections/feature-voting/index.tsx:148-152` — the server *upserts* rather than adds, so the optimistic `+=` drifts high and needs a reconciling refetch; the comment says so. Personas has the same construction on the unread badge (`messageSlice.ts:113`, `+ 1`). Two codebases, no shared code, same defect. |
| 5 | **⚠ The user is never told the optimistic value was wrong** | **PHYSICS as a DEFECT (majority)** | `personas-web`'s three live optimistic writes (`feature-voting/index.tsx:71,113,136`) each roll back correctly and each precede it with **`Sentry.captureException` only** — no toast, no banner. The vote count ticks back with no explanation. `vibeman/src/app/features/Goals/components/GoalLifecyclePanel.tsx:142-176` is worse: local state including recomputed counts is mutated at `:143`, the comment at `:157` reads *"Fire-and-forget — no refetch needed"*, and the `.catch` at `:165` calls `onRefresh()` and shows the user nothing. |
| 6 | **⚠ THE ONE THAT REPLICATED — the optimistic engine gets built and never imported** | **PHYSICS as a DEFECT (2 of 5 siblings)** | `personas-web/src/stores/personaStore.ts:180-225` — `commitOptimisticUpdate`, with a **per-id mutex** (`:65`) and a **CAS rollback** that reverts only if the field-set it wrote still holds (`patchStillApplied`, `:73-81`) — the best optimistic machinery in the fleet. **Zero call sites** (14 repo-wide hits: 12 in `docs/`, 2 in the file itself). Its own audit already says so: *"cannot have ever shipped working"* (`docs/harness/bug-test-scan-2026-06-19/agents-personas-management.md:6`). `vibeman/src/stores/context/contextMoveQueue.ts:39` is the same story — `ContextMoveQueue` with rollback at `:184-191`, **zero importers**, while the live drag-drop path is a *reimplementation* at `contextStore.ts:545,582` that happens to be better. |
| 7 | **A conflict is distinguished from a failure** | **LOCAL to Personas (1 of 6) — this repo is ahead** | `rowWrites.ts:98` + `useUnifiedTriage.ts:1071`. No sibling has any equivalent; the sweep found no `409`, no `If-Match`, no expected-version token on any optimistic path outside this repo. Reported as Personas-ahead **and** as an adoption problem: 1 of 34 sites uses it. |
| 8 | **SILENCE — a reusable, USED optimistic primitive** | **0 of 6** | Every optimistic write in every one of the six codebases is bespoke to its surface. The two attempts at a reusable one (clause 6) both have zero consumers. Reported as a silence. |
| 9 | **SILENCE — declining to be optimistic, on purpose** | **1 of 6, and it wrote the argument** | `brainiac/console` has **zero** optimistic writes across 118 `.ts`/`.tsx` files, and `src/components/AddressBar.tsx:24-30` states the position: *"'copied' is confirmed only after the clipboard promise RESOLVES. An optimistic tick that lies when the write is blocked — the failure mode a previous wave already fixed on the keys page — teaches an operator that the control is decorative."* **Not being optimistic is a design position, not an omission**, and it is the right one for a control whose whole job is to confirm. |
| 10 | **One idea to steal** | `personas-web` | `src/hooks/useReviewBulkActions.ts:222,290-300` — a 5-second **undo window** where the write is *deliberately deferred*, polling is paused so a server read cannot overwrite the optimistic rows, and the pending PATCHes are **flushed on unmount** rather than dropped. That is optimistic-UI-as-a-feature rather than as a latency hide, and it is the only place in the fleet where the pending write survives teardown — which is [`debounced-autosave`](./debounced-autosave.md)'s missing clause, solved in a sibling, on a different leaf. |

**Physics — keep as doctrine:** clauses 1, 2, 4, 5, 6 (4, 5, 6 as defects).
**Reported as silence:** clauses 8 and 9.
**Personas is ahead** on clause 7 (conflict-vs-failure) and **behind** on clauses 2 and 3 —
`ascent` has the better rollback *and* the sequence guard *and* the only tests, with no library and
no shared document.

> **The strongest external result is clause 6, and it is not agreement — it is the same failure twice.**
> Two sibling repos independently built a sophisticated optimistic engine (a mutex plus a CAS
> rollback; a queue plus a rollback), documented it, and shipped **zero call sites**, while the live
> paths beside them hand-rolled something simpler. `entity-draft-editing` §6 found this three times
> for draft machinery and `debounced-autosave` §6 found it twice more for timers. **Across three
> leaves and four repos, the reusable abstraction for a client-side write concern is built and then
> not adopted.** That is why §9 below counts a *shape* rather than proposing a fifth primitive — and
> why §2 prescribes an inline discipline that a developer can follow in the file they are already in.

## 7. Deviations

Every entry is live on `master` @ `17d059b1f` and was verified by reading the file, by replay against
real store code, or against a read-only copy of the operator's database.

### D1 — P0. Four writes in one store paint permanently on failure, and the store never re-reads

`src/features/plugins/dev-tools/sub_workspaces/workspaceStore.ts` is a module-scoped store published
through `useSyncExternalStore` (`:139`). Four mutations paint and then dispatch:

| Site | Paint | Failure path |
|---|---|---|
| `:171-181` `renameWorkspace` | `commit({… workspaces.map(w => w.id===id ? {…w, name} : w)})` | `.then(refreshWorkspaces).catch(toastCatch('workspaceStore:rename'))` |
| `:183-189` `recolorWorkspace` | same shape, `color` | `.catch(toastCatch('workspaceStore:recolor'))` |
| `:191-201` `deleteWorkspace` | `commit({workspaces: …filter(w => w.id !== id), activeId: …})` | `.catch(toastCatch('workspaceStore:delete'))` |
| `:203-222` `assignProject` | `commit({… projectIds moved between workspaces})` | `.catch(toastCatch('workspaceStore:assign'))` |

**The refetch is on the success branch in all four.** `toastCatch(ctx)` returns `(err) => void`; it
has no access to the pre-image and it does not refetch, so it is **structurally incapable** of
undoing the paint.

**Executed** (verbatim transcription of `:191-201`): after a rejected `apiDeleteWorkspace`, the
snapshot holds `[w2]` and the only trace is `workspaceStore:delete: DB is locked` in a toast.

**And nothing repairs it.** `ensureHydrated()` (`:117-124`) is guarded by a module-level
`hydrateStarted` boolean (`:52`) set on the first `subscribe`/`getSnapshot`, so `refreshWorkspaces`
runs **once per process**. All six `useWorkspaces()` consumers read the same lying snapshot for the
rest of the session; the only external caller of `refreshWorkspaces()` is `PatternsPanel.tsx:57`, on
mount. On this install the table holds **2 workspaces**, so a failed delete hides half of them.

> **This is the composition defect [`debounced-autosave`](./debounced-autosave.md) §5 predicted, one
> notch worse than predicted.** That path warns that a module-scoped **warm-paint cache** repaints a
> lost write on remount. Here the module-scoped store is not a cache *beside* the source of truth —
> it **is** the only source of truth the UI reads, and it has no remount-triggered refetch to be
> wrong about. There is nothing to invalidate. Corrected in §12.4.

**Fix:** move the refetch to `.finally`, or — better — give `commit` an inverse: `renameWorkspace`
should capture `const prevName = …` and restore that one field in the `.catch`. And drop
`hydrateStarted` to a per-mount `useEffect` refresh, or expose `refreshWorkspaces` on the surfaces
that mutate.

### D2 — P0. A local latch outranks the server for the life of the mount, under a success toast

`src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx:138-153`:

```ts
  const [optimisticCancelled, setOptimisticCancelled] = useState(false);
  const handleCancel = useCallback(async () => {
    setOptimisticCancelled(true);                                        // :142
    useOverviewStore.getState().processEnded('competition','cancelled',competition.id);
    addToast(dl.competition_cancelled_cleaning, 'success');              // :145  BEFORE the write
    onRefresh();
    cancelCompetition(competition.id).catch((err) => {                   // :149  not awaited
      silentCatch('CompetitionCard:handleCancel:cleanup')(err);
      addToast(tx(dl.background_cleanup_issue, {…}), 'error');
    });
  }, …);
  const effectiveStatus = optimisticCancelled ? 'cancelled' : competition.status;   // :165
```

Four defects stack: (a) **the success toast precedes the write** (P4); (b) the write is
fire-and-forget and its `.catch` restores nothing; (c) `setOptimisticCancelled(false)` **appears
nowhere in the file** — grep returns one write, `true`; (d) `:165` makes the latch outrank
`competition.status`, so `onRefresh()` and the 8-second auto-poll both re-read the true row and the
render discards it.

**Executed** (verbatim, `:140-165`): after a rejected `cancelCompetition` and a refreshed
`competition.status === 'running'`, `effectiveStatus` is `'cancelled'`. The user has seen a green
success toast and a red toast calling the failure a *"background cleanup issue"* — which describes
tidying up after a cancellation that did not happen.

**Fix:** await the write; paint after, or paint before and clear the latch in a `catch`; move the
success toast below the `await`; and reconcile `optimisticCancelled` to `false` whenever
`competition.status` arrives from the server.

### D3 — P1. `usePresetAdoption` leaves rows claiming work that failed

`src/features/templates/sub_presets/usePresetAdoption.ts:183-192` paints the failed roles to
`status: 'adopting'` and, on rejection (`:216-219`), toasts and **does not touch the rows** — they
sit at *"adopting"* forever. The sibling path at `:130-142` paints every selected role to `'queued'`
and on failure reverts the *stage* (`setStage('preview')`) but not the rows. One surface, two
adoption entry points, neither restoring what it painted.

### D4 — P1. Nine rollbacks erase writes that landed during the round trip

The census population (§9). Every one of these binds a **copy of the whole collection** before the
paint and assigns it back in the `catch`:

| Site | Action | What the rollback replaces |
|---|---|---|
| `teamSlice.ts:231` | `removeTeamMember` | `teamMembers` **and** `teamConnections`, both wholesale |
| `teamSlice.ts:281` | `deleteTeamConnection` | `teamConnections` |
| `teamSlice.ts:299` | `updateTeamConnection` | `teamConnections` |
| `teamSlice.ts:369` | `deleteTeamMemory` | `teamMemories` + `teamMemoriesTotal` |
| `teamSlice.ts:384` | `batchDeleteTeamMemories` | `teamMemories` + `teamMemoriesTotal` |
| `teamSlice.ts:397` | `updateTeamMemoryImportance` | `teamMemories` |
| `teamSlice.ts:427` | `updateTeamMemory` | `teamMemories` |
| `alertSlice.ts:315` | `deleteAlertRule` | `alertRules` + `alertFiredCooldowns` |
| `alertSlice.ts:342` | `toggleAlertRule` | `alertRules` |

**Executed against the real slice** — S1 and S3 in §0. The blast radius on this install is **64 team
members, 70 connections and 347 memories** across 8 teams; `alert_rules` currently holds **0 rows**,
so 2 of the 9 are latent here and will not be on an install that uses alerts.

**Fix, and it is in the same file:** `teamSlice.ts:203-208` and `:265-270`. Recompute from live
state, scoped to the id you touched, inside the same "have we switched entity?" guard.

### D5 — P1. Four surfaces write through conflict-aware doors and none of them asks

`rowWrites.ts` turns every verdict into a compare-and-swap and exports `isDecisionConflict` (`:98`) so
a caller can tell *"your write failed"* from *"someone already decided this"*. Three call sites ask:
`useUnifiedTriage.ts:1071,1156` and `useMonitorData.ts:429`. The other consumers —
`useBacklogQueue.ts:105-118`, `useDevToolsActions.ts:56-59`, `useInboxActions.ts:63,78`,
`triageDispatch.ts:183-187` — do not. `useBacklogQueue`'s `act()` (`:104-111`) wraps every verdict in
`catch { silentCatch('useBacklogQueue:act')(err); }`, so on the Backlog table **a lost race and a
failed write are both a row that quietly stays where it was, with no message at all** — and the
docstring on the door it called (`devToolsTriageSlice.ts:82`) says it rejects *"so an optimistic
caller can put the row back."*

This matters more than it reads: `rowWrites.ts:22-27` records that since Athena's Night Shift began
resolving approvals unattended overnight, **the compare-and-swap loser is a routine event rather than
a race.** On this install `dev_ideas` holds 236 rows, 54 of them still `pending`.

### D6 — P2. Two silent reverts, and two literal-instead-of-pre-image restores

- `useMonitorData.ts:481-489` — an unread message optimistically leaves the list; on failure
  `logger.error` and `void reloadMessages()`. The row reappears with no explanation.
- `useConversation.ts:99-127` — a proposal painted `'launching'`; on failure `silentCatch` and the
  status reverts to the **literal** `'pending'` rather than whatever it was.
- `useConnectorStatuses.ts:216-236` — a connector link painted optimistically; on failure the row is
  restored to `credentialId: null`. Correct when the connector was unlinked; **wrong when the user was
  re-linking**, which shows *unlinked* while credential A is still linked server-side. (`linkError` is
  set, so the user is told *something*.)
- `messageSlice.ts:104-113` — the row is restored from a field-level pre-image (correct) but the badge
  is restored with `unreadMessageCount + 1` (an inverse op). If any count refetch landed in between,
  the badge is off by one until the next read. `personas-web` hit the identical drift with `+=` and
  wrote it down (§6 clause 4).

### The measurement that could not be made

I queried the database expecting to size the damage — how many rows a screen has lied about. **There
is no such query, and the reason is the finding.**

The database is *always right* in this leaf. An optimistic paint that was wrong leaves no row, no
column, no timestamp; the only artifact is a pixel that disagreed with SQLite for a while, and
nothing records pixels. Even the one hypothesis that *was* checkable came back clean —
`persona_team_members`, `persona_team_connections` and `team_memories` hold **0 rows with a `temp-`
id**, so no optimistic placeholder has ever escaped to the backend.

This is the mirror image of [`entity-draft-editing`](./entity-draft-editing.md) §7, whose measurement
also failed: there, `NULL` meant both "cleared" and "never set", so the damage was unauditable
*because two states collapsed into one value at rest*. Here the damage is unauditable because **it
never reaches rest at all**. Both point the same way: *these defects are findable only by running the
system*, which is why §0 is six replays and not a query — and why §9's gate can only key on the shape
of the code, never on evidence of harm.

### Structural — the shape of the leaf

- **34 optimistic writes in 25 files**, against **944** awaited write-door call sites — **3.6%**.
- **6 restore strategies.** Snapshot-replace 9 · scoped-recompute 5 · scalar pre-image 4 · refetch 4 ·
  compensate-in-place 3 · literal 2 · none 6. (One site, `messageSlice`, uses two at once.)
- **No two feature areas share a mechanism unless they share a file.** The same distribution
  `entity-draft-editing` §7 found for dirty flags (7 mechanisms, 17 computations) and
  `debounced-autosave` §7 found for delays (11 values, 11 files).
- **1 of 34 distinguishes a conflict from a failure**; **0 of 34 guard the order of two optimistic
  writes to the same row** (`useDebouncedSaveGroup` exists and is scoped to the persona editor).
- **2 of 34 tell the user nothing at all.** This is much better than the sibling repos, where the
  majority of live optimistic writes revert in silence (§6 clause 5).
- **The word "optimistic" appears in 56 files and does not mean this leaf in most of them.**
  `credentialSlice.ts:166,205,257` all say *"Optimistic:"* above a paint that happens **after** the
  await — they mean *optimistic that the list needs no refetch*, a reconciliation shortcut. See §12.1.

### Second pass — what is upstream of all of it

Re-reading the deviations together: 9 erasing rollbacks, 6 absent ones, 2 literal ones, 4 refetches
and 1 latch are not independent lapses.

> **Nothing in the code holds the pair.** The paint and its inverse are one object, and this codebase
> has no way to write them as one — so each of 34 sites writes the paint (easy, visible, satisfying)
> and then, separately and later, tries to reconstruct the inverse from whatever is in scope. What is
> in scope is a copy of the collection, so that is what gets restored.

Where the pair *is* held together — `useUnifiedTriage.decide`, where a `Set<id>` makes the paint
`add` and the inverse `delete`; `teamSlice.addTeamMember`, where a temp id makes the paint an append
and the inverse a filter-by-that-id — the rollback is correct **as a consequence of the
representation, not as an act of care**. Where it is not, the developer must remember a rule nobody
wrote down, and 9 of them remembered the wrong one.

And the convergence sweep says the same thing from the other end: the two siblings that *did* build
the pair as one object (`commitOptimisticUpdate`, `ContextMoveQueue`) got the semantics right —
a mutex, a CAS-guarded revert, a queue — and **neither has a single importer**. The fix is not more
care at the call site, and it is not a fifth primitive nobody will import. It is to make the
*representation* carry the inverse: paint through an id-keyed patch, and the undo writes itself.

## 8. Gaps in the primitive

1. **There is no `useOptimistic`-shaped helper anywhere in the repo**, and React 19's own
   `useOptimistic` — which this project's React version ships — has **zero call sites in six repos**.
   Its semantics (the optimistic value is discarded when the transition settles, so the server always
   wins) are exactly P5, for free. Nobody has tried it. That is the single cheapest experiment in this
   document.
2. **`rowWrites` is the right door and covers one row *family*.** It handles reviews, ideas,
   practices, policy proposals and promotion proposals — every row a human *decides*. It has nothing
   to say about a team member, a connection, a memory, a workspace or a toggle, which is where all 9
   erasing rollbacks and all 6 missing ones live. The concentration is real and its boundary is
   "decidable row", not "optimistic write".
3. **`isDecisionConflict` is a predicate over an error *message*.** `rowWrites.ts:54-77` documents why
   (`AppError::Validation` is the only channel these repos have) and pins every phrase in a test. It
   works, and it means every caller must remember to *ask* — 3 of 7 do. A discriminated rejection
   would make forgetting a compile error; the doors already know which case they are in.
4. **`reportError` returns a string and never throws.** `storeTypes.ts:100-150`. That is right for a
   fetch and wrong for an optimistic write, and the repo has patched around it five times with an
   explicit `throw` on the next line. There is no `reportAndRethrow`, so the correct spelling is two
   statements that must not drift apart.
5. **Nothing orders two optimistic writes to the same row.** `useDebouncedSaveGroup` (the repo's only
   write-ordering guard) is welded to the persona editor and unexported outside `sub_editor/libs`.
   `ascent` solved this with an eight-line per-row monotonic sequence; nothing here does.
6. **A module-scoped store has no invalidation contract.** `workspaceStore` hydrates once per process
   by design (`hydrateStarted`, `:52`) and there is no shared "this data is stale, re-read" channel a
   failed write could ring. Every consumer would have to know to call `refreshWorkspaces` itself.
7. **The optimistic paint has no rendering vocabulary.** [`inline-busy-state`](./inline-busy-state.md)
   splits busy states into *a surface loading* and *an action pressed*; `debounced-autosave` §8 gap 8
   already noted that an autosave is neither. **An optimistically-painted row is a fourth case** — it
   is not busy, it is *provisional* — and there is no shared way to render "shown but not yet true".
   `credentialSlice`'s `pendingDeleteCredentialIds` (a greyed, non-interactive row) is the closest
   thing in the tree and it is one feature's private convention. Offered upward rather than filed
   here.
8. **No rollback logic in this repo is tested.** Zero of the 34 sites have a test that drives the
   failure branch. `ascent` extracted its rollback transforms into pure functions specifically so they
   could be, and they are the only tested ones in six codebases.

## 9. The missing gate

**The condition, stack-free:** *the screen asserts something the server has not confirmed, and either
nothing withdraws the assertion or the withdrawal takes back more than it put in.*

**What a signal cannot see, and why that decides the gate.** Half of this leaf's damage is an
**absence** — no rollback, no clear, no refetch — and the census **cannot assert an absence**
([doctrine §4](../golden-path-doctrine.md#4-census-rules)). It cannot say "no code puts this row
back", "this latch is never set to false", or "this store never re-reads". Those are §7 D1 and D2, the
two P0s, and they are ungateable by counting; they must be fixed by hand and held by review.

So the gate targets the half that is **present and countable**: the rollback that exists and is built
the wrong way. This is an unusual and deliberate framing — **the rule fires only on code that already
did the right thing**, and says the right thing was done in the shape that erases other people's
writes.

**The signal, and what it is a proxy for.** A `catch` block whose state write **assigns an
identifier captured before the write** (`prev*`, `previous*`, `snapshot*`, `original*`) into a store
key, rather than recomputing from live state. It is a proxy for *"the undo restores the world, not
the change"* — and it is stack-specific as the contract requires: a repo using an immutable
patch/inverse pair, an ORM unit-of-work, a CRDT, or `useOptimistic` (where the runtime discards the
overlay and there is nothing to restore) has the same condition wearing markup this pattern cannot
see, and would score a structural zero. **The condition to re-derive elsewhere is "does the undo
name the collection or the change", not the token `prev`.**

**Precision: 9/9, hand-verified.** Every match was opened and confirmed to be a whole-collection
restore inside an optimistic write's failure branch. Two false-positive families were removed **by
construction**, not by allowlist:

- **Span leakage past the catch block.** An untempered version matched 21 times across 12 files by
  running out of one `catch` and into an unrelated `set(...prev...)` many lines below —
  `BundleImportDialog.tsx:240`, `useApiTestRunner.ts:187`, `useDesignAnalysis.ts:238`,
  `platform.ts:22` and eight more. Removed by tempering the span between `catch {` and `set(` with
  `[^{}]`, which refuses to cross any nested block.
- **`preview*` identifiers.** A naive `prev` prefix matches `previewExecution`, `previewPrompt`,
  `previewBundleImport` and 30 more across `src/api/` — the word list must be
  `(?:prev|previous|snapshot|original)` with the *following* character class doing the work, and the
  match must be a property **value** (`: prevX` followed by `,` or `}`), which a call expression is
  not.

**Positive control — mandatory, and it partitions.** The identical `catch { … set(` anchors with the
snapshot-identifier discriminator moved into a **negative lookahead**, pointed at the compliant form —
a rollback that recomputes from live state (`set(s => ({ rows: s.rows.filter(…) }))`) — match
**5 times across 4 files** against the gate's **9 across 2**. So the rule discriminates on the
*shape of the restore*, not on the token `catch`: **64% of this repo's in-catch state restores replace
a collection and 36% recompute one.** The control deliberately carries **no `baseline`** — a ratchet
is monotone-downward and a rule counting compliant code would fail the build every time adoption
improved; `engine.mjs:377` exempts a `-positive-control` id from the baseline requirement and
`merge-published-rules.mjs` skips it.

**Disclosed recall gaps — three, all structural:**

1. **The control under-counts compliance and I know by how much.** Two genuinely correct restores are
   invisible to it: `teamSlice.ts:203` (three comment lines sit between `catch {` and the `if`, and
   the engine matches **raw source** — comments are not stripped, only matches *starting* on a comment
   line are skipped) and `messageSlice.ts:107-113` (its restore is a hoisted arrow function
   containing braces). Widening the span to admit braces is what re-introduces the 12 span-leakage
   false positives, so the control is a **floor on compliance**, not a census of it. My own tester
   stripped comment lines and reported 6; the engine reports 5, and **the engine is the authority
   because the engine is what runs.**
2. **A rollback spelled as a hoisted variable is invisible.** `set({ teamMemories: restored })` where
   `restored` was computed three lines earlier carries no `prev*` token at the assignment. No
   textual signal anchored on the assignment can see it; that needs type information.
3. **The gate cannot see the two P0s.** §7 D1 and D2 are absences and a latch — neither has a
   `catch` with a `set` in it at all. **The gate's count can reach zero while the worst two defects in
   this document are untouched**, which is stated here so nobody reads a green census as coverage.

**Why this is a census rule and not an ESLint rule.** The countable signal is textual and the
mechanism wanted is a ratchet. The *better* instrument is an ESLint rule with type information that
flags, inside a `CatchClause`, a state-setter argument whose value is an identifier bound to a
collection **outside** the try — it closes gap 2, can see the block structure as an AST node rather
than as text, and can autofix `set({k: prevK})` into `set(s => ({k: recompute(s.k)}))` only where the
inverse is derivable. It is worth building and it is not this. A second, different instrument is owed
for §7 D2's latch: a `useState` boolean that is written `true` in exactly one place and never `false`,
and is read in a conditional whose other branch is a prop — that is an AST question, not a count.

**How it fails loudly.** Inherited from the runner: a walk seeing fewer than `floor` files fails
("matcher broken, not codebase clean"); zero matches anywhere fails; a stale `exclude` fails; a count
that *drops* without the baseline being updated fails, because a silent drop is a broken matcher more
often than fixed code.

**Where it runs.** `npm run census:check` — the corpus's own gate, invocable locally and by the
maintenance loop, ~0.4 s for these two rules over 4,829 files. Per this batch's calibration,
`ci.yml` is red on 10 pre-existing failures, so **a gate that only runs in CI runs nowhere**; the
census runner is the reason the ratchet lives there rather than in a new CI step. It is also reachable
from the `golden-path-census` pre-push job.

**This rule cannot express "must be zero", and it should be zero.** All 9 matches are removable —
the compliant form is in the same file for 7 of them (`teamSlice.ts:203`, `:265`) and one file away
for the other 2. When the count reaches 0 the runner will fail structurally on zero-matches **by
design**: at that point **delete the rule, do not baseline it at 0**.

**Validated standalone before publication**, in a composer-private registry with a filename unique to
this composer (`rules-optimistic-update-composer.json`), then re-extracted from this document and
re-run — both runs report `files 2 / matches 9` for the gate and `files 4 / matches 5` for the
control, over 4,829 files walked and 4,829 scanned against a floor of 3,000, with
`commentMatchesSkipped 0`. **The full registry was not run**, per doctrine §4.

```json
{
  "id": "snapshot-replace-rollback",
  "goldenPath": "docs/concepts/golden-paths/optimistic-update.md",
  "title": "An optimistic write's rollback restores a whole collection from a snapshot taken before the write, so every change that landed during the round trip is erased when it fires",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "catch\\s*(?:\\([^)]{0,40}\\))?\\s*\\{[^{}]{0,240}?\\bset(?:[A-Z]\\w*)?\\s*\\(\\s*\\{[^{}]{0,200}?:\\s*(?:prev|previous|snapshot|original)[A-Za-z]*\\s*[,}]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a catch block that restores a store key by ASSIGNING an identifier captured before the write (prev*/previous*/snapshot*/original*) rather than recomputing the collection from live state. PROXY FOR the stack-free condition: the undo restores the WORLD, not the CHANGE - so every write that landed during the round trip is erased along with the optimistic one. EXECUTED, not argued: the real createTeamSlice from src/stores/slices/pipeline/teamSlice.ts was mounted in a Zustand-shaped harness (the same shape as the repo's own credentialSlice.race.test.ts) with @/api/pipeline/* mocked and the write held open on a deferred. removeTeamMember: members [m-A,m-B] -> optimistic [m-A] -> a concurrent add lands [m-A,m-C] -> the IPC rejects -> ROLLBACK [m-A,m-B], and m-C is gone from the screen while existing in the database. updateTeamMemoryImportance: [mem-1=1,mem-2=1] -> paint [mem-1=5,mem-2=1] -> the user drags the OTHER row [mem-1=5,mem-2=4] -> reject -> ROLLBACK [mem-1=1,mem-2=1], and mem-2 snaps back with no message. The SAME FILE 28 lines earlier contains the correct form: addTeamMember (teamSlice.ts:203-208) rolls back with state.teamMembers.filter(m => m.id !== tempId), under a comment reading 'Rollback atomically - only remove our temp entry, preserve concurrent changes', and replaying the identical interleaving against it preserved the concurrent insert. That is a controlled experiment inside one file, by one author, on one concept - the knowledge existed and did not generalise, because nothing in the code carries it. Measured 2026-08-16 at HEAD: 9 matches across 2 files, ALL NINE OPENED AND CONFIRMED (precision 9/9), commentMatchesSkipped 0, over 4829 files walked and 4829 scanned. Reconciles with two independent inventories of the leaf's population that DISAGREED (21 by collection-shape, 72 by data-flow) and were both wrong; hand classification of the union gave 34 optimistic writes in 25 files, of which these 9 are the snapshot-replace family. TWO FALSE-POSITIVE FAMILIES ARE EXCLUDED BY CONSTRUCTION rather than by allowlist: (a) SPAN LEAKAGE - an untempered version matched 21 times across 12 files by running out of one catch block and into an unrelated set(...prev...) many lines below (settings/sub_network/components/BundleImportDialog.tsx:240, vault/shared/playground/useApiTestRunner.ts:187, hooks/design/core/useDesignAnalysis.ts:238, lib/utils/platform/platform.ts:22 and eight more), removed by tempering the span between `catch {` and `set(` with [^{}] so it cannot cross a nested block; (b) `preview*` IDENTIFIERS - a bare prev prefix matches previewExecution, previewPrompt, previewBundleImport and ~30 more across src/api/, removed by requiring the match to be a property VALUE (`: prev<X>` followed by `,` or `}`), which a call expression is not. THE NINE, EXACTLY: teamSlice.ts:231 removeTeamMember (restores teamMembers AND teamConnections wholesale), :281 deleteTeamConnection, :299 updateTeamConnection, :369 deleteTeamMemory, :384 batchDeleteTeamMemories, :397 updateTeamMemoryImportance, :427 updateTeamMemory; alertSlice.ts:315 deleteAlertRule (restores alertRules AND alertFiredCooldowns), :342 toggleAlertRule. Blast radius on the operator's live database (read-only copy, deleted after composition): 64 persona_team_members, 70 persona_team_connections, 347 team_memories across 8 teams; alert_rules currently holds 0 rows, so 2 of the 9 are latent on this install and will not be on one that uses alerts. Also verified there: 0 rows with a `temp-` id in any of the three tables, so no optimistic placeholder has ever escaped to the backend. THIS RULE FIRES ONLY ON CODE THAT ALREADY DID THE RIGHT THING - it does not count missing rollbacks, because half this leaf's damage is an ABSENCE and the census cannot assert an absence: it cannot say 'nothing puts this row back' (workspaceStore.ts:171,183,191,203 - four optimistic mutations whose .then(refreshWorkspaces).catch(toastCatch(..)) puts the refetch on the SUCCESS branch, in a module-scoped store that hydrates once per process via a hydrateStarted latch at :52, so a failed rename/recolor/delete/move is the truth for the rest of the session) or 'this latch is never set false' (dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx:142 sets optimisticCancelled true, :165 renders `optimisticCancelled ? 'cancelled' : competition.status`, and setOptimisticCancelled(false) appears NOWHERE in the file). Both are P0s in the golden path and both must be fixed by hand - a green count here is NOT coverage. DISCLOSED RECALL GAPS, all three structural: (1) the positive control UNDER-COUNTS compliance by at least 2 known-correct restores - teamSlice.ts:203 (three comment lines sit between `catch {` and the `if`, and the engine matches RAW SOURCE, skipping only matches that START on a comment line) and messageSlice.ts:107-113 (its restore is a hoisted arrow function containing braces) - and widening the span to admit braces is exactly what re-admits the 12 span-leakage false positives, so the control is a FLOOR on compliance rather than a census of it; (2) a rollback spelled as a hoisted variable is invisible - `set({ teamMemories: restored })` where `restored` was computed three lines earlier carries no prev* token at the assignment, and closing that needs type information; (3) the gate cannot see WHICH optimistic write a catch belongs to, so a snapshot-replace restore in a non-optimistic context would count - none exists today and all 9 were confirmed by hand. PRECONDITION (must be re-derived per repo): this repo hand-rolls every optimistic write on Zustand `set` / React `setX` with a `const prev… = get().X` pre-image - a convergence sweep of five siblings found React 19's own useOptimistic used ONCE in six codebases and only one repo (vibeman) using a mutation library's optimistic machinery at all. A repo using an immutable patch/inverse pair, an ORM unit-of-work, a CRDT, or useOptimistic (where the runtime discards the overlay, so there is nothing to restore) has the SAME condition wearing markup this pattern cannot see and scores a structural zero. The condition to re-derive is 'does the undo name the COLLECTION or the CHANGE', not the token `prev`. POSITIVE CONTROL: the identical `catch { .. set(` anchors with the snapshot-identifier discriminator moved into a NEGATIVE LOOKAHEAD, pointed at a rollback that recomputes from live state, match 5 times across 4 files against this gate's 9 across 2 - so 64% of in-catch state restores in this repo replace a collection and 36% recompute one, and the rule discriminates on the SHAPE of the restore rather than on the token `catch`. LEGAL FIX, in order: (1) bind the smallest pre-image that lets you write the inverse - one field or one id, never the collection - and apply the inverse scoped to the row you touched, recomputing from live state: stores/slices/pipeline/teamSlice.ts:203-208 and :265-270 are the shape to copy and they are in the same file as seven of these nine; (2) where the paint is an append, use a temp id so the inverse is a filter on that id (teamSlice.ts:180-190); where it is a membership, use a Set so the inverse is delete (quick-answer/triage/useUnifiedTriage.ts:1039,:1085); where it is one field, save that field (overview/messageSlice.ts:74); (3) also ask whether the rejection is a LOST COMPARE-AND-SWAP rather than a failed write - lib/decisions/rowWrites.ts:98 isDecisionConflict is the discriminator and useUnifiedTriage.ts:1071 the only correct consumer - because restoring a row somebody else legitimately decided re-offers a decision that can never land. Do NOT silence a match by hoisting the snapshot into a variable named something else (that hides it from the rule without fixing it) or by deleting the rollback entirely (that converts a P1 into the P0 at workspaceStore.ts:191). END OF LIFE: this rule is designed to reach zero - all 9 are removable and the compliant form is in the same file for 7 of them. When it does the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
  },
  "baseline": { "files": 2, "matches": 9 },
  "floor": 3000
}
```

```json
{
  "id": "snapshot-replace-rollback-positive-control",
  "goldenPath": "docs/concepts/golden-paths/optimistic-update.md",
  "title": "POSITIVE CONTROL - the same anchors pointed at a rollback that RECOMPUTES from live state instead of replacing the collection with a snapshot",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "catch\\s*(?:\\([^)]{0,40}\\))?\\s*\\{(?:[^{}]{0,160}|[^{}]{0,100}\\{[^{}]{0,60})\\bset(?:[A-Z]\\w*)?\\s*\\((?!\\s*\\{[^{}]{0,200}?:\\s*(?:prev|previous|snapshot|original)[A-Za-z]*\\s*[,}])\\s*\\(?\\s*(?:\\(?\\s*\\w{1,12}\\s*\\)?\\s*=>|state|get\\(\\))[^;]{0,240}?\\.(?:filter|map|delete|add)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The identical `catch { .. set(` anchors as snapshot-replace-rollback, with that rule's snapshot-identifier discriminator moved into a NEGATIVE LOOKAHEAD, so it matches the COMPLIANT form: a rollback whose new value is computed from the LIVE state (a functional setter, `state`, or `get()`) and scoped by a filter/map/delete/add rather than replacing the collection with a copy captured before the write. Exists to prove the gate discriminates on the SHAPE OF THE RESTORE rather than on the token `catch`: measured 2026-08-16 at HEAD it matches 5 times across 4 files against the gate's 9 across 2, so 64% of this repo's in-catch state restores replace a collection and 36% recompute one. All 5 were opened and confirmed - stores/slices/pipeline/teamSlice.ts:265 (the surgical temp-id removal, whose sibling at :203 is the same shape), features/vault/sub_databases/tabs/ChatTab.tsx:137 and :172 (mark the optimistic assistant bubble failed in place rather than deleting it), features/fleet/monitor/channels/useConversation.ts:126 (revert one proposal by id), features/agents/sub_connectors/libs/useConnectorStatuses.ts:223 (restore one connector row by name). DELIBERATELY A FLOOR ON COMPLIANCE, NOT A CENSUS OF IT: it misses at least two known-correct restores - teamSlice.ts:203, where three comment lines sit between `catch {` and the `if` and the engine matches raw source (it skips only matches that START on a comment line), and stores/slices/overview/messageSlice.ts:107-113, whose restore is a hoisted arrow function containing braces - and widening the span to admit braces is precisely what re-admits the 12 span-leakage false positives the gate was tempered to exclude. Carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved, and engine.mjs:377 exempts a `-positive-control` id from the baseline requirement while merge-published-rules.mjs skips it by construction. If this control's count ever collapses toward the gate's, the shared anchors have broken and BOTH numbers are meaningless - that is the failure this control exists to make visible."
  },
  "floor": 3000
}
```

## 12. Corrections to the brief

Recorded per [doctrine §7](../golden-path-doctrine.md#7-corrections-are-the-deliverable), because a
brief is a hypothesis and refuting it is part of the job.

**12.1 — "The store pattern is Zustand slices with `set((state) => ...)`; several actions replace an
entity in place 'optimistically' after an await."** True as description, and it names the trap. **In
this repo the word "optimistic" means two different things and the more common one is not this leaf.**
`credentialSlice.ts:166`, `:205` and `:257` each say *"Optimistic:"* directly above a paint that
happens **after** the await — they mean *optimistic that the list does not need a refetch*, a
reconciliation shortcut. A vocabulary sweep on the word finds 56 files and would have put the repo's
**cleanest** surface (a slice that also implements the tentative `pendingDeleteCredentialIds` pattern,
§6) into the defect list. The structural test — *is the paint before or after the await* — is the only
one that separates them, and it is why this sweep was built on brace-matched enclosing-function
resolution rather than on grep.

**12.2 — "A prior path found 'optimistic with no rollback' cleared 0 of 3 in its territory — but only
because none of the three wrote to a server at all. Test that properly here."** Tested properly, and
**the condition is present: 6 of 34 sites have no rollback**, all six writing to SQLite through IPC.
The prior finding was a sampling artifact, and the correction matters in a specific way: the
no-rollback family clusters in a **module-scoped store** (`workspaceStore` ×4), not in components. A
sweep that looks for optimistic writes inside React components — which is where the concept is usually
taught — misses the worst instances by construction, because a module store has no unmount, no
remount, and no `useEffect` to re-read on.

**12.3 — "38 reseed effects clobber user edits on refetch; 3 persisted drafts have 0 invalidation;
68 reads in 32 files launder a failure into an empty value; and 0 of 232 save-catch blocks discard the
draft."** All four are inherited from sibling paths and **none was re-measured here**; they are cited
as context, not as evidence. But the last one needs an explicit boundary, because it reads as
reassurance and is not: **"0 of 232 save-catch blocks discard the draft" has no jurisdiction over this
leaf.** A draft is the user's *input* and a rollback destroys the user's *result* — opposite values,
opposite rules. The repo's blanket discipline of never discarding on failure is correct for
`entity-draft-editing` and would be a bug here; the one place the two collide,
`usePendingInteractions.ts:130-146`, was resolved by *removing* the optimism, and the comment there
says why. §2 states the discriminator: **ask whether the value came from the user or from the
server.**

**12.4 — "A dropped write is invisible when a module-scoped warm-paint cache repaints the stale value
on remount — a composition defect already recorded in `debounced-autosave`."** The composition is real
and **the brief's model of it is a notch too gentle.** In `debounced-autosave`'s version the module
cache sits *beside* a source of truth and wins a race on remount. In `workspaceStore` (§7 D1) the
module store **is** the only source of truth the UI reads, and `ensureHydrated`'s `hydrateStarted`
latch means it re-reads the backend **once per process**. There is no stale repaint on remount because
there is no re-read on remount — the lie is not a cache-coherence problem, it is the state. That is
a different and worse composition, and it generalises: *when the optimistic paint and the warm cache
are the same object, invalidation has nowhere to live.*

**12.5 — "whether a rollback restores the *prior* value or a refetched one."** The brief's two
options are not the partition that predicts loss. Measured, there are **six** restore strategies, and
the axis that decides whether other people's work survives cuts **across** both of the brief's
categories: `set({rows: prevRows})` and `set(s => ({rows: s.rows.filter(…)}))` are *both* "restore the
prior value", and only the second one is safe. The right question is **does the undo name the
collection or the change** — which is what §9's gate keys on, and it would not have been asked if the
brief's framing had been accepted.

**12.6 — my own two implementations disagreed 21 vs 72 and both were wrong.** Implementation A
anchored on the *shape of the paint* (a collection transform in a state setter before an awaited write
door) and found 21. Implementation B anchored on *data flow* (a state setter sharing an identifier
with the write's arguments) and found 72. Hand classification of the union gave **34**. A's misses
were scalar toggles (`setMode(next)` above `await setAutopilotMode`) and one hoisted paint
(`const optimistic = prev.map(…); set({teamMemories: optimistic})` at `teamSlice.ts:409`); B swept in
**22 per-row busy flags** (`setKilling(pid)`, `setPendingMemberId(id)`) which are correct
`inline-busy-state` code. **And both missed `useConnectorStatuses.ts:216` for the same reason** — its
write goes through a *local* wrapper rather than a direct `@/api/*` import, so the door vocabulary,
which is resolved per file from that file's own imports, never saw it. That is the doctrine's
"a vocabulary-based signal's recall is bounded by its author's word list" arriving one layer down: the
list was resolved automatically and correctly, and indirection still defeated it.

**12.7 — the brief's convergence label was `diverged`, and it is right for the wrong reason.** The
sweep found divergence, but not the kind the label implies: the fleet does not disagree about *how* to
do optimistic updates — four of six hand-roll the same `paint → await → restore` shape with no shared
code. What diverges is **whether the restore is correct**, and the best implementation in six
codebases is `ascent`'s (`useInstallationRepos.ts:205-262` + tested pure rollback transforms +
a per-row monotonic sequence), which this repo has no equivalent of on any of the three counts.
Personas is ahead of the fleet on exactly one axis — telling a lost race apart from a failed write —
and behind on the two that decide whether a rollback is right.
