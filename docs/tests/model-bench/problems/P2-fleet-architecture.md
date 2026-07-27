# P2 — personas: review the fleet autonomy machine, then ship the strongest move

**Repo:** `C:\Users\kazda\kiro\personas`
**Shape:** architecture review of a mature live system + execute inside the session
**Deliverable:** prioritized critique + one shipped improvement with evidence
**Weights:** framing 1.0 · architecture 2.0 · creativity 1.5 · rigor 1.0 · evidence 1.5 · tradeoffs 1.0 · craft 2.0

---

## The brief (verbatim to the session)

> ### Context
>
> Fleet is this app's Claude Code session aggregator: it spawns `claude` in PTYs,
> consumes Claude Code lifecycle hooks into a state machine, reconstructs each
> session's terminal through a vt100 emulator, and — with the companion (Athena) —
> runs an **autonomy machine** that reads parked sessions' screens, decides, types
> answers into their question TUIs, batches assessments to conserve turns, doses
> resources via doze/hibernate, and self-heals through usage-limit outages. It has
> been load-tested at 16 and 30 concurrent sessions.
>
> Start from `docs/features/plugins/dev tools/fleet.md` — in particular *The
> autonomy machine — code reference* table, which maps each mechanism to its code
> anchor. Then read the code: `src-tauri/src/commands/fleet/**` (`pty.rs`,
> `registry.rs`, `stale.rs`, `transcript.rs`, `transcript_read.rs`,
> `headless.rs`), `src-tauri/src/commands/companion/fleet_bridge.rs` and
> `approvals/`, and `src/features/plugins/fleet/**`.
>
> The document is thorough and mostly accurate. **Do not let it do your thinking.**
> It describes what was built and why; it does not tell you what is structurally
> weak, what will break at the next scale step, or what capability is being left
> on the table.
>
> ### Your task, in two parts
>
> **Part A — the review.** Produce a prioritized architecture and design critique.
> What you are looking for is not a bug list: it is the small number of *structural*
> observations that change what should be built next. Some directions worth
> pressure-testing (not a checklist — your own findings are worth more):
>
> - The registry is in-memory; the fleet's state does not survive a restart.
> - Decision-making is a single serialized companion turn lock, drained in
>   coalesced batches. Consider its throughput ceiling and its failure geometry.
> - Screen reading is a vt100 reconstruction of a TUI — a screen-scrape of a
>   product that changes shape between releases (this has already broken once,
>   when questions became tabbed).
> - Several correctness properties are enforced by timing (350ms, 120ms, 12s, 60s,
>   4min) rather than by confirmation.
> - The cost model: Athena's orchestration turns spend the same subscription the
>   fleet spends.
> - The mechanical protocol (`FLEET:DONE`/`FLEET:NEXT`) resolves wakes with no
>   model turn at all. Where else does that idea generalize?
> - What a fleet of N sessions could do that N terminals cannot — the capability
>   frontier, not just the efficiency frontier.
>
> **Part B — ship the strongest one.** Pick the highest-leverage item you can
> execute well *inside this session*, and build it. One coherent change, not a
> scattering. Judgment about *what to build* is weighted as heavily here as the
> quality of the build.
>
> ### Hard constraints
>
> - You are in a git worktree. **Work only here. Do not commit, do not push, do not
>   `git stash`, do not `git add -A`, do not touch any other branch.** Leave your
>   work in the working tree — that is the deliverable.
> - **The desktop app cannot be launched.** It is a single shared instance and it
>   is unavailable to you. Everything you claim must therefore be backed by
>   compile-time and test-time evidence: `cargo clippy --manifest-path
>   src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path
>   src-tauri/Cargo.toml --lib`, `npx tsc --noEmit`, `npm run test -- --run`.
>   Design for testability accordingly — a change whose correctness can only be
>   asserted by running the app is a weaker choice here, and knowing that should
>   inform Part B.
> - Do not regress the autonomy loop. If your change alters a mechanism the table
>   in `fleet.md` names, say so explicitly and justify it.
> - Keep the diff single-purpose and reviewable. Scope discipline is scored;
>   sprawl is not ambition.
> - Prefer changes that add no new user-facing strings. If you must add one, add
>   the `en.json` key and record the untranslated locales in `EVIDENCE.md` —
>   do **not** spend the session running the 13-locale translation pipeline.
> - Do not modify `.claude/active-runs.md`, and do not write to this project's
>   memory directory.
> - **You will not be able to ask anyone anything.** Where the brief is ambiguous,
>   resolve it yourself and *state the assumption you made* in `REVIEW.md`. How you
>   handle the ambiguity is part of what is being read.
> - End your final message with `RUN:DONE — <summary>`.
>
> ### Deliverables
>
> 1. `REVIEW.md` at repo root — the prioritized critique. For each item: the
>    observation, the evidence in code, why it matters, and what it would cost to
>    address. Rank them, and say plainly which one you chose and why it beat the
>    others.
> 2. The implementation of your chosen item, with tests.
> 3. `EVIDENCE.md` at repo root — every claim you make about your change working,
>    each with the exact command or test that backs it. Anything you could not
>    verify goes in a clearly separate "unverified" section. That is a correct
>    answer, not a failure.

---

## Why this problem

Fleet is the operator's most actively evolving system, it is well documented (so
the *retrieval* floor is high and every variant starts from the same map), and the
work has two independently scorable halves that usually trade off:

- **Choice quality** — did it find something structural, or restate the doc?
- **Execution quality** — is the built thing good code?

A low-effort variant is expected to pick a safe, small, correct item. A high-effort
variant may find the deeper structural item — or may over-build and fail its
gates. That tension is exactly the measurement.

The "app cannot be launched" constraint is not an artifact of the benchmark alone
— it is also a real, honest reflection of this repo's standing rule that *config
gates are not delivery*. It forces every variant into the same evidence regime,
which is what makes their `EVIDENCE.md` files comparable.

## Practical notes for the operator

- **Cargo contention is the binding constraint.** Eight concurrent Rust worktrees
  on one machine will either fight over a shared target dir (serializing, and
  corrupting the wall-clock metric) or consume very large amounts of disk with
  per-worktree targets. **Run P2 in two waves of four**, per-worktree
  `CARGO_TARGET_DIR`, and record the wave in each run's metadata.
- `cargo test` on the full binary has historically failed at link time in
  worktrees; `cargo check` + `cargo test --lib` is the working combination. The
  brief already asks for `--lib`.
- Unlink any `node_modules` junction **before** removing these worktrees.
- Live validation of the winning changes (if the operator wants it) is a
  **serialized post-run activity** on the main checkout, not part of scoring.

## Fallback answer sheet

Runs are headless — there is no question surface. This sheet applies **only** if a
run is executed interactively as a fallback (README §4.5); then these are the
*only* permitted answers, and each one is logged and shown to the judge.

| If the session asks | Answer verbatim |
|---|---|
| "Can I run the app / the test-automation bridge?" | "No. The app instance is unavailable. Compile- and test-time evidence only." |
| "Should I do Part A only, or is shipping required?" | "Both. Part B is required." |
| "May I pick more than one improvement?" | "One coherent change. Scope discipline is scored." |
| "Is a large refactor acceptable?" | "Only if you can defend it in review and keep the gates green." |
| "May I add a dependency?" | "Yes if justified in REVIEW.md; prefer not to." |
| anything unanticipated | "Use your judgment; take the option you'd defend in review." (log it) |
