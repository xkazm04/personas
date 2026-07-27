# P3 — pumper: design extraction that survives the web changing

**Repo:** `C:\Users\kazda\kiro\pumper`
**Shape:** greenfield design of a large subsystem — **design only, no implementation**
**Deliverable:** a design document plus its evaluation plan
**Weights:** framing 2.0 · architecture 2.0 · creativity 1.5 · rigor 1.5 · tradeoffs 1.5 · executability 2.0 · evidence 0.5

---

## The brief (verbatim to the session)

> ### Context
>
> Pumper is a local-first scraping service: one Rust binary, an HTTP API, a durable
> SQLite job queue, and three pluggable engines (`http` · headless-Chrome
> `browser` · a headless Claude Code CLI `claude` engine for research-style
> scraping a crawler can't do). Read `README.md` and `docs/features/` — especially
> `extraction.md`, `datasets.md`, `fetching.md`, `crawling.md`, `apps.md`,
> `triggers.md` — before deciding anything.
>
> The pieces you will be building on already exist and are load-bearing:
>
> - **Declarative `RuleSet` extraction** (css / regex / json-pointer / xpath /
>   const / `each`), compiled once and run across all cores.
> - **A per-field quality report** — every extraction is `matched` | `empty` |
>   `error`, so a broken selector is at least *distinguishable* from a genuinely
>   absent field, and the `extractor` app already reports `worst_fields` with
>   miss-rates.
> - **A dataset store with change intelligence** — content hash + 64-bit SimHash
>   per record, `new | changed | unchanged`, field-level diffs in
>   `record_revisions`, full-snapshot removal detection, a `/changes` feed.
> - **A tiered fetcher with learned host memory**, a per-domain governor, a
>   content-addressed HTTP cache, a WASM plugin sandbox with fuel + memory caps,
>   and an embedded Tantivy index.
>
> ### The problem
>
> **Sites change, and extraction rots silently.** A selector that stops matching
> produces `empty`, which is indistinguishable in aggregate from a field that is
> legitimately absent this week. A selector that *still* matches after a redesign
> can quietly start capturing the wrong element — the most dangerous case, because
> every counter stays green while the dataset fills with plausible garbage. There
> is no ground truth to check against: nobody labels the web.
>
> Today pumper has counters and diffs. It has no notion of a source *degrading*,
> no way to repair itself, and no way to express how much a given record should be
> trusted. Nothing in the roadmap addresses it.
>
> ### Your task
>
> Design the subsystem that fixes this. **Write the design; write no code.**
>
> The problem is genuinely open, so the design work is in taking defensible
> positions on hard questions rather than enumerating features. At minimum you
> will have to decide:
>
> - **Detection without ground truth.** What signals actually distinguish *the
>   extractor broke* from *the content changed* from *the fetch was transient*?
>   What is the statistical shape of the decision, and what does it cost to
>   compute at this scale?
> - **The silent-corruption case.** Everything green, values wrong. This is the
>   hard one. Take a real position on it.
> - **Repair.** The `claude` engine can propose a new selector. Under what
>   conditions is that trustworthy, how is a proposal validated *before* it is
>   allowed to touch a dataset, and what stops it overfitting to the one page it
>   was shown?
> - **Trust and quarantine.** What is the lifecycle of a source that is degrading
>   but not dead? What do downstream consumers (the search index, `/changes`
>   subscribers, webhooks) see meanwhile — and what must they never see?
> - **Promotion and rollback.** How does a repaired rule become the live rule, who
>   or what authorizes that, and how is it undone when it turns out to be wrong
>   three days later?
> - **Cost governance.** Repair is the expensive path. What bounds it?
> - **Data model and API.** Concrete schema changes, migrations, endpoints,
>   config surface — specific enough to build from.
> - **Failure modes.** Where does your own design fail? Poisoned repairs,
>   oscillation, a site that A/B tests its markup, a source that legitimately goes
>   empty for a week.
> - **Non-goals.** What you are deliberately not solving.
>
> A design that assumes an LLM can be trusted to judge correctness, or that
> assumes a human will review anything, will not survive contact with this
> system's constraints — it runs unattended on one machine.
>
> ### Hard constraints
>
> - **Design only. Write no implementation code.** Illustrative type/schema
>   sketches inside the document are expected and welcome; changes to `crates/`
>   are not. The only file you create is the design document.
> - You are in a git worktree. Do not commit, push, `git stash`, `git add -A`, or
>   touch any other branch. Leave the file in the working tree.
> - Ground every design decision in what this repo actually has. A design that
>   ignores the existing SimHash / revisions / quality-report / governor
>   primitives, or that reinvents them, is a worse design.
> - The document must include an **evaluation plan**: how would you *prove* this
>   works, given that the thing it detects is by definition invisible? Be concrete
>   about what you would measure and what would falsify the design.
> - Do not write to this project's memory directory.
> - **You will not be able to ask anyone anything.** Where the brief is ambiguous,
>   resolve it yourself and *state the assumption you made* in the document. How
>   you handle the ambiguity is part of what is being read.
> - End your final message with `RUN:DONE — <summary>`.
>
> ### Deliverable
>
> `docs/features/resilient-extraction.md` — the design. Structure it as you see
> fit. It will be read by an engineer who knows this codebase and who has to build
> it without asking you anything.

---

## Why this problem

The purest test of design skill in the set, and the cleanest read on whether
reasoning effort buys better *plans* or merely longer ones.

It was chosen over the kp alternative for one reason: **it is not already
answered anywhere in the repo.** kp's frontiers are extensively pre-designed
across ~25 docs, so a design task there measures retrieval. Pumper has no drift,
repair, canary, or trust machinery — in docs or in code — while simultaneously
offering an unusually sharp set of existing primitives the design *must* compose
with. That combination (open problem, tight constraints) is what separates a
designer from a summarizer.

It also has three built-in traps that reliably discriminate:

1. **The ground-truth trap.** The naive design compares against a golden set. The
   good design reasons about where a golden set comes from, what it costs to keep
   fresh, and what it can and cannot cover.
2. **The silent-corruption trap.** Most designs will optimize for detecting
   *misses* (easy, already half-instrumented) and quietly skip *wrong values*
   (hard). Skipping it is visible in scoring.
3. **The LLM-in-the-loop trap.** The `claude` engine makes "just ask the model to
   fix the selector" the obvious move. A strong design treats the model as an
   untrusted proposal generator behind a deterministic validator, and says so.

## Grading notes for the judge (beyond the shared rubric)

- Does the design distinguish **broken**, **changed**, and **transient**, and give
  each a different response? (Collapsing them is the single most common failure.)
- Does it take a real position on silent corruption, or gesture at it?
- Is the repaired-rule promotion path **reversible**, and is the reversal
  automatic or manual? Is that choice argued?
- Does it name a bound on repair cost, or does the expensive path run unbounded?
- Does the evaluation plan include something **falsifiable**, or is it a list of
  dashboards?
- Does it compose with SimHash / `record_revisions` / the quality report / the
  governor — or shadow them with parallel machinery?

## Fallback answer sheet

Runs are headless — there is no question surface. This sheet applies **only** if a
run is executed interactively as a fallback (README §4.5); then these are the
*only* permitted answers, and each one is logged and shown to the judge.

| If the session asks | Answer verbatim |
|---|---|
| "May I write a prototype crate to validate the design?" | "No. Design only. Sketches inside the document are fine." |
| "How much may I assume about scale?" | "Single machine, local-first, SQLite. Assume the scale the repo already runs at." |
| "Is the paid Claude engine allowed on this path?" | "It is available; bounding its cost is part of your design." |
| "Should I cover the browser engine's failures too?" | "Your call — scope it and justify the scope." |
| "How long should the document be?" | "Long enough that an engineer can build from it and no longer." |
| anything unanticipated | "Use your judgment; take the option you'd defend in review." (log it) |
