---
name: research
version: 1.5
description: Extract actionable improvements for a project from external sources (video, blog, article, raw text). Scores ideas against the codebase, buckets into Code / Template / Credential, and persists findings to an Obsidian memory vault.
argument-hint: "[source or question]"
category: Maintenance
memory: vault
---
# Research

Extract actionable improvements for the personas project from any external source (YouTube video, blog post, article, raw text). Score ideas against the codebase, bucket into Code / Template / Credential, and either auto-invoke `/add-template`, `/add-credential`, or persist code-improvement findings to the Obsidian memory vault.

This skill is **personas-specific.** It uses `.claude/codebase-context.md` (refreshed by `/refresh-context`) for fast relevance scoring and the Obsidian vault at `C:/Users/kazda/Documents/Obsidian/personas` for long-term memory and self-improvement.

## Input

Ask the user, in this order:

1. **"What is the source? Paste a YouTube URL, an article URL, or raw text."**
2. **"Any focus hint? (`code` / `templates` / `credentials` / `all`) — defaults to `all`."**

Wait for both answers before proceeding. Do NOT ask anything else upfront — further questions only if a phase requires clarification.

---

## Constants

- **Codebase reference files** (all under `.claude/`, generated/maintained by `/refresh-context`):
  - `codebase-context.md` — DB-derived feature map (8 groups, 34 contexts, file paths, keywords). Always loaded.
  - `codebase-stack.md` — hand-curated architecture, **Claude Code CLI engine wrapping**, persona schema, tech stack, conventions. Always loaded.
  - `codebase-catalogs.md` — current 92 templates + 87 connectors with coverage gaps. Loaded only when bucket B or C is in scope.
- **Feature reference docs (`docs/features/`)** — implemented-product reference kept in sync with source via the Stop hook described in `.claude/CLAUDE.md` → "Documentation Sync". Use these on demand in Phase 6 when `codebase-context.md`'s keywords / file lists are too coarse to anchor a finding precisely. The README at `docs/features/README.md` indexes every area + plugin to its implementation roots:
  - Core areas: `home.md`, `onboarding.md`, `overview/`, `personas/`, `templates/`, `execution/`, `connections/`, `events/`, `recipes/`, `settings/`
  - Plugins: `artist.md` + `artist/`, `companion/`, `dev-tools.md`, `drive/`, `brain/`, `research-lab.md`, `twin.md`
  - Read the relevant feature doc before deep-greping when a finding lands inside one of those areas — the doc's "primary user flows / backend command surface / data model / known gaps" sections often surface the exact attachment point and pre-existing infrastructure faster than a wide grep.
- **Obsidian vault:** `C:/Users/kazda/Documents/Obsidian/personas`
  - `Research/` — one note per run
  - `Lessons/` — self-reflection notes
  - `Patterns/user-preferences.md` — distilled rules across runs
  - `00 - Index.md` — vault entry point
- **Existing template catalog (filesystem):** `scripts/templates/` (mirror of catalogs file)
- **Existing credential catalog (filesystem):** `scripts/connectors/builtin/` (mirror of catalogs file)

---

## Phase 0: Bootstrap Vault (one-time)

Check if `C:/Users/kazda/Documents/Obsidian/personas/00 - Index.md` exists. If not, create the structure:

```
C:/Users/kazda/Documents/Obsidian/personas/
  00 - Index.md
  Research/
  Lessons/
  Patterns/
    user-preferences.md
```

`00 - Index.md` content:
```markdown
# Personas Memory Vault

Long-term memory for the `/research` skill and other personas-related work.

## Folders
- [[Research/]] — one note per `/research` run, source + extracted ideas + triage decisions
- [[Lessons/]] — self-reflection notes from each `/research` run (what was rejected and why)
- [[Patterns/]] — distilled rules across runs ([[Patterns/user-preferences|user preferences]])

## Conventions
- Research notes: `YYYY-MM-DD-{slug}.md` with frontmatter (source, date, accepted, rejected)
- Lessons notes: `YYYY-MM-DD-research.md` — append-only, one block per run
- Patterns are upgraded from Lessons after a rule has been observed 3+ times
```

`Patterns/user-preferences.md` content:
```markdown
# User Preferences (distilled from /research runs)

> Rules upgraded from `Lessons/` after 3+ observations. Loaded by `/research` Phase 1.

_No patterns yet. Will be populated as runs accumulate._
```

---

## Phase 1: Load Context & Memory

### 1a. Determine which reference files to load

Based on the focus hint, load this set:

| Focus | Files loaded |
|---|---|
| `code` | `codebase-context.md` + `codebase-stack.md` |
| `templates` | `codebase-context.md` + `codebase-stack.md` + `codebase-catalogs.md` |
| `credentials` | `codebase-context.md` + `codebase-stack.md` + `codebase-catalogs.md` |
| `all` (default) | all three |

`codebase-context.md` and `codebase-stack.md` are **always required**. `codebase-catalogs.md` is only required when bucket B or C is in scope.

### 1b. Verify required files exist

For each required file under `.claude/`:
- If `codebase-context.md` is missing → stop, instruct to run `/refresh-context`
- If `codebase-stack.md` is missing → stop, ask user to regenerate it (it's hand-curated; suggest the user ask Claude to recreate it from `src-tauri/src/db/models/persona.rs`, `src-tauri/src/engine/provider/`, `package.json`, and `Cargo.toml`)
- If `codebase-catalogs.md` is missing AND focus needs it → stop, instruct to run `/refresh-context`

### 1c. Read and absorb the loaded files

Read each loaded file in full. These three files together describe:
- **codebase-context.md** — *where* code lives (8 groups, 34 contexts, file paths, keywords)
- **codebase-stack.md** — *how the engine works* (Claude Code CLI wrapping, persona schema, tech stack, conventions)
- **codebase-catalogs.md** — *what already exists* (92 templates, 87 connectors, coverage gaps)

The `codebase-stack.md` Section 2 ("Engine: Claude Code CLI Wrapping") is the **single most important fact** — personas literally spawns the `claude` binary as its LLM provider. Any idea about Claude Code CLI features (hooks, slash commands, MCP, settings, output styles, subagents, session resume) is **highly relevant** to this codebase, not out of scope.

### 1d. Check snapshot freshness

Parse the `<!-- snapshot-meta -->` footer in `codebase-context.md`. Compare:
- `git_commit_count` vs current `git rev-list --count HEAD`
- `generated_at` vs today

If commits have advanced by >200 OR snapshot is >30 days old, warn but continue:
```
Warning: codebase-context.md may be stale ({N} commits / {D} days since last refresh).
Consider running /refresh-context after this session.
```

Also check `codebase-catalogs.md` `Generated:` line if loaded; warn similarly if >30 days old (the catalogs change more frequently than the DB-derived feature map).

### 1e. Load memory

Read in order:
1. `C:/Users/kazda/Documents/Obsidian/personas/Patterns/user-preferences.md`
2. `C:/Users/kazda/Documents/Obsidian/personas/Architect/strong-patterns.md` (if present) — these are the canonical shapes the codebase already does well. When a code-bucket finding's attachment point matches a strong pattern, prefer "extend the existing strong pattern" over "build something new" in Phase 6/7. Cite the strong pattern in the per-idea detail under an `Aligns with:` line.
3. The 3 most recent files in `C:/Users/kazda/Documents/Obsidian/personas/Lessons/` (sorted by filename, descending)

These inform extraction priorities and what to deprioritize.

---

## Phase 1.5: Register in the Active-Runs Ledger

Multiple CLI sessions often work in parallel on this checkout, on the same branch, without branching. The `.claude/active-runs.md` ledger is the coordination surface for them. Touch it twice: once here at session start, once in Phase 13.

Full design and rationale: [`docs/architecture/cli-coordination.md`](../../../docs/architecture/cli-coordination.md). Format conventions live at the top of the ledger file itself (see also `.claude/CLAUDE.md` → "Concurrent CLI sessions").

### 1.5a. Read the ledger and check for conflicts

Read `.claude/active-runs.md`. Scan the `## Active` section. For each entry:

- **Live conflict:** entry status is `started` AND timestamp is **less than 2 hours old** AND any of its declared `Paths` overlaps your planned scope.
- **Overlap rule:** a planned path is a prefix of an active path, an active path is a prefix of a planned path, OR the two are equal.
- **Stale (`started` >2h ago):** mention to the user in your next text update; do NOT silently rewrite the other session's entry.

Your **planned scope** for `/research` is approximately:
- `Obsidian/personas/Lessons/{date}-research.md` (always — shared-by-date file, but Edit-not-Write rule already handles concurrent writers)
- `Obsidian/personas/Research/{date}-{slug}.md` (always — per-run slug, no collision risk)
- The directories of accepted findings' file anchors (varies — `docs/concepts/`, `src-tauri/src/...`, `scripts/templates/`, etc.)
- For Phase 12 (release log): `src/data/releases.json` + `src/features/home/components/releases/i18n/`
- `.claude/active-runs.md` itself (always — coordination surface, expected overlap)

You don't know all final paths until Phase 6/8. The Phase 1.5 declaration should be a conservative best guess based on the source type and focus hint; update later via Edit if scope changes materially in Phase 6.

### 1.5b. Conflict resolution

If a live conflict exists (overlap on something other than `.claude/active-runs.md`), ask the user:

```
Active session conflict detected:

  [<their-timestamp>] <their-skill> — <their-slug>
  Paths: <their-paths>
  Overlap with your plan: <overlapping-path(s)>

Options:
  1. Abort this run.
  2. Coordinate manually — you'll resolve before continuing.
  3. Proceed with awareness — both runs in flight, you accept the merge risk.
```

Honor the user's pick. Default behavior on no answer: ask once more, then proceed-with-awareness rather than aborting silently.

Overlap on `.claude/active-runs.md` alone is **expected** — it's the coordination surface. Do not flag that as a conflict.

### 1.5c. Append your entry under `## Active`

Do **not** hand-edit the ledger — run the script. It picks the authoritative
`## Active` section, stamps the time, formats the entry and refuses a duplicate slug:

```bash
node scripts/active-runs.mjs register --slug <slug> --title "/research on <source>"   --paths ".claude/skills/**" "docs/concepts/" --source "<url>"
```

The `<slug>` should match the one you'll use in Phase 9's Research note path (kebab-case
from the source title, <=40 chars).

Phase 1.5a's conflict check is the same script, and its exit code is the answer —
`0` clean, `2` live conflict:

```bash
node scripts/active-runs.mjs check --paths ".claude/skills/**" "docs/concepts/"
```

It already excludes `.claude/active-runs.md` itself (expected overlap — it is the
coordination surface) and already ignores entries past the 2-hour staleness window, so
you do not re-implement either rule by hand.

---

## Phase 2: Source Ingestion

Detect source type from the user's first answer:

### 2a. YouTube URL
Patterns: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`

Check `yt-dlp` is installed:
```bash
yt-dlp --version
```

If missing, abort with:
```
yt-dlp is not installed. Install it with one of:
  - winget install yt-dlp
  - pip install yt-dlp
  - Download from https://github.com/yt-dlp/yt-dlp/releases
Then re-run /research.
```

Otherwise, extract auto-generated subtitles:
```bash
mkdir -p .research-cache
yt-dlp \
  --skip-download \
  --write-auto-sub \
  --sub-lang en \
  --sub-format vtt \
  --output ".research-cache/%(id)s.%(ext)s" \
  "<url>"
```

Parse the resulting `.vtt` file:
- Strip WEBVTT header
- Strip cue settings and styling
- Collapse consecutive duplicate lines (auto-subs repeat heavily)
- Keep timestamps in `[HH:MM:SS]` format every ~30 seconds for citation

If no `.vtt` was produced (some videos have transcripts disabled), report the issue and ask the user to paste the transcript manually or provide an alternative source.

**Cleanup (MANDATORY, scoped to THIS run's video id):** as soon as the cleaned text is in working memory, delete the cache files this run created. Do this before Phase 3 starts — not at the end of the run, where a mid-run failure or context exhaustion would leave strays.

```bash
# Replace <id> with the actual video id used in --output above. Glob covers
# both the .vtt and any .clean.txt / .cleaned.txt sibling some scripts emit.
rm -f .research-cache/<id>.* 2>/dev/null
```

Rules for the cleanup:
- **Scope strictly to this run's id.** Never sweep `.research-cache/*` blindly — that races with any parallel research run on the same machine and could delete another run's working files.
- **Idempotent on failure.** If the rm fails (locked file, etc.), log it as a `cache_cleanup_skipped` note in the Lessons block but continue — leaving cache is not a run-blocking error.
- **Verify in Phase 11.** The final summary's "Files updated" block should include `Cache: cleaned` (or list the residue path if cleanup failed) so the user has a one-line signal that this run did not pollute `.research-cache/`.
- **`.research-cache/` is gitignored** (see repo `.gitignore`). Stragglers from old or interrupted runs no longer surface in `git status`, but they DO accumulate on disk — `/research` runs are the only legitimate cleaner. Don't rely on git status to remind you.

### 2b. Other URL
Use `WebFetch` with a prompt asking for the article body, stripped of nav/footer/ads.

**A landing page is not the source.** When the URL is the front door of a multi-page site —
a specification, a docs set, a standard, a product's documentation tree — the overview page
is a marketing summary and the substance lives one level down (`/specification`, `/docs`,
`/reference`, `/schema`). Fetch the substantive subpage(s) BEFORE applying the thinness
check below, or a rich source gets rejected as thin. Run 2026-08-13 (agent-plugins.org) hit
this: the overview returned ~250 words of positioning, while `/specification` carried the
entire normative contract that produced both shipped findings. Budget the same way as
Phase 2.5 — two or three focused fetches, not a crawl. A 404 on a guessed subpath is cheap;
guess from the overview's own links rather than from convention.

**An aggregator listing is not the source either — and the word floor will NOT catch it.**
Distinct trap from the landing page above. Directory and marketplace sites that index
artifacts hosted elsewhere (skills.sh, plugin/skill registries, awesome-lists, package
pages, "SKILL.md viewers") render a *rewritten summary* of the artifact, often behind a
"Show more" toggle that WebFetch cannot expand. What comes back is fluent, adequately
long, and sails past the <300-word check — while being a paraphrase of the thing you were
asked to evaluate. Every finding downstream would then be scored against prose the author
never wrote.

**When the source URL is an aggregator listing for a git-hosted artifact, resolve it to
the repository before Phase 3.** The listing names the owner/repo; find the real path with
one call rather than guessing:

```bash
gh api repos/<owner>/<repo>/git/trees/main?recursive=1 --jq '.tree[].path' | grep -i <artifact-slug>
gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d > .research-cache/<slug>.md
```

Guessing the path costs a 404 (run 2026-08-13 assumed `skills/<name>/SKILL.md`; the file
was at `plugins/business-analytics/skills/<name>/SKILL.md`). The tree listing is one call
and is never wrong. **Fetch every file the artifact splits itself across** — that run's
SKILL.md was 770 words and pointed at a `references/details.md` carrying another 1,241,
including all three layout patterns and every worked example.

Tells that a page is a listing rather than the artifact: an installs/stars counter, a
"Repository:" field, a security-audit badge, a `<slug>` in the URL path that looks like
`<owner>/<repo>/<artifact>`, or fetched text that describes the content in the third
person ("The skill covers…", "the full content appears truncated"). Treat any of those as
a hard signal to go to the repo. `.research-cache` cleanup (Phase 2a) applies to files
fetched this way too.

### 2c. Raw text
Use as-is.

**Sanity check:** if the resulting text is <300 words **after** the subpage pass above,
report it's too thin to harvest meaningful ideas and stop.

> **Source-type agnosticism confirmed.** Runs 1-5 used YouTube videos (Phase 2a); run 6 used a blog article (Phase 2b WebFetch). Both paths produced the same downstream shape — same frontmatter, same Phase 6 rules, same output formats. The skill is source-type agnostic; do not special-case downstream phases based on whether the source came from 2a, 2b, or 2c.

---

## Phase 2.5: Web Augmentation (technique/tooling lookup)

YouTube transcripts (and many talks/articles) name a tool or technique without explaining how it actually works. A speaker says "we use Sieve for the video step", "we agentic-RAG the docs", "we route through OpenRouter" and moves on — leaving the cleaned text technique-shaped without enough depth for a clean Phase 6 evidence pass. This phase fills that gap with a **bounded** web round.

### 2.5a. Decide whether to run

Run web augmentation when **all** of these hold:
- The cleaned source text references at least one **named tool, framework, model, library, protocol, technique, or workflow pattern** that is non-obvious from the transcript alone
- A correct Phase 6 evidence pass would benefit from knowing how that thing actually works (API shape, key concepts, integration points, current pricing/auth model)
- The reference is not already deeply documented inside the codebase or in `codebase-stack.md`

**Skip the phase** when the source is fully self-contained (e.g. a philosophical article, a product launch where the post itself IS the spec, or raw text the user already curated for the run). Don't run web augmentation on every source — it costs tool calls and can drift into rabbit-holes.

### 2.5b. Build the lookup list

From the cleaned text, list the candidate names — typically 1-5 items. For each, record:
- `name` — exact spelling as it appears in the source
- `kind` — `tool` | `framework` | `model` | `library` | `protocol` | `technique` | `workflow_pattern`
- `why_useful` — one line on how a deeper definition would change Phase 6 framing

Drop items that are:
- Already in `codebase-catalogs.md` (Phase 1c will have loaded it for the relevant focus) — those are catalog hits, not augmentation candidates
- Generic primitives (`HTTP`, `JSON`, `webhook`) — no augmentation value
- Brand names of commodities the speaker only name-drops without using (`AWS`, `npm`, etc.)

### 2.5c. Run the lookup (bounded)

For each surviving candidate, prefer one focused query over many shallow ones. Cap at **3 web calls total** for the phase — this is augmentation, not full research.

- **First** try `WebSearch` with `<name> <kind> <year>` (e.g. `Sieve video API 2026`). One query is usually enough to surface the canonical product page or docs URL.
- **Then** `WebFetch` the single most authoritative result (vendor docs, RFC, GitHub README) with a prompt like: *"Extract the core concept, API surface, auth model, and how it would integrate with a desktop AI agent app. Skip marketing copy."*
- If the candidate is a YouTube creator's house technique (no canonical doc page), search for `<creator name> <technique>` and pick the best blog-post or follow-up video transcript.

Stop early once the technique is understood. Do NOT fetch every result.

### 2.5d. Capture the augmentation note

For each looked-up item, write a 2-4 sentence note in working memory:
- **What it is** (one sentence)
- **How it works at a high level** (one sentence — the load-bearing technical fact)
- **Integration shape** (one sentence on auth model / API surface / boundary of responsibility)
- **Why it matters for personas** (one sentence — does it suggest a credential, a template, a code pattern?)

These notes are scratch — they feed Phase 3 (better extracted-idea quality), Phase 5 (better bucket assignment, especially separating "credential candidate" from "library to wrap"), and Phase 6 (better grep terms — knowing the protocol name lets you grep for the right thing).

### 2.5e. Write the cited URLs into the Research note

In Phase 9, the Research note frontmatter gets a new optional list:
```yaml
web_augmentations:
  - { name: "Sieve", url: "https://www.sievedata.com/...", kind: "tool" }
```
This makes the augmentation traceable on future re-reads and prevents re-fetching on Phase 3 cross-checks of `descoped-reopenable.md`.

### 2.5f. Anti-patterns

- **Don't run augmentation to validate the speaker's claims.** That's `/research`'s next phase (Phase 6 evidence against the codebase). The web round is for technique definition, not opinion-checking.
- **Don't quote the augmentation source as a Phase 7 source anchor.** The source anchor still belongs to the original transcript/article — augmentation only sharpens framing.
- **Don't escalate a web-augmentation discovery into a finding on its own.** If WebSearch surfaces "this product also has a credential-relevant API the speaker didn't mention", that's a candidate idea for the original source's surface area, not a new source. Add it as an extracted idea in Phase 3 with `source_anchor: "(web augmentation, not in transcript)"`.

---

## Phase 3: Raw Idea Extraction

From the source text, extract 5-15 distinct ideas. Each idea must be:
- A concrete technique, pattern, tool, or recommendation (not opinions or filler)
- Grounded in a specific quote or timestamp from the source
- Standalone enough to be evaluated independently

### Compare mode — read the source as a checklist to FAIL, not a menu to shop

When the invocation frames the run as a comparison against an existing module
("compare X with our implementation of Y", "does this skill help our design",
"what does this have that we don't") — usually with an explicit *don't adopt it*
— the default generative reading produces almost nothing. Against a mature
module, "what could we take from this?" returns ideas already built, and the run
drifts toward padding the finding count with things the catch table would have
covered.

**Invert the question. Go principle by principle through the source and ask
"which of these do we FAIL?"** Extraction is then per-principle rather than
per-idea: every Do/Don't, every checklist item, every troubleshooting entry
becomes one candidate whose verdict is `catch` (we honor it, cite where),
`fail` (a real finding), or `n/a` (different domain — say so, don't score it).

Two things fall out of this that the generative reading misses:

- **The findings come from the source's least glamorous material.** Run
  2026-08-13 (kpi-dashboard-design vs the KPI module) drew both accepted
  findings from a one-word checklist bullet ("Time-bound") and an ASCII layout
  diagram — while the source's SQL, its dashboards and its Streamlit code, the
  parts that *look* like the substance, were entirely inapplicable. A generative
  reading gravitates to the code blocks and finds nothing.
- **The catch table IS the deliverable, and must be stated as such up front.**
  That run closed 2 findings against 13 catches (~1:6, catch-dominant even by
  the listicle row's standard). Leading with "your module is ahead of this
  source on 13 of 15 points, and here are the 2 it isn't" is the honest answer
  to what was actually asked. Do not bury it under the findings.

Where the source's advice is *worse* than what the repo already does, say so
and keep the repo's shape — an outside checklist is not automatically the
higher authority. That run declined the source's "cap the dashboard at 5-7
KPIs" in favor of surfacing the ranking the schema already stored, because a
cap hides KPIs while a ranking does not. Record the reasoning; a future run
re-reading the same source should not have to re-litigate it.

For each idea, capture:
- `title` — short imperative phrase (<60 chars)
- `summary` — 1-2 sentences
- `source_anchor` — quote (≤20 words) or `[HH:MM:SS]` for video sources
- `tentative_bucket` — your initial guess: `code` / `template` / `credential` / `unclear`

Apply memory-informed filtering: if `Patterns/user-preferences.md` says "user rejects migration ideas" or similar, deprioritize matching ideas (still extract, but mark `low_priority: true`).

**Also check `Patterns/descoped-reopenable.md`** (if it exists) for findings that were previously descoped but may now be viable due to changed ecosystem conditions. If any apply to the current source, surface them explicitly in Phase 7 as "previously descoped, reconsider?" items alongside the new findings.

### Source-type yield calibration

Different source types produce different finding profiles. **A "low" finding count is not a failure mode if it matches the source type's expected yield.** Don't force extraction past the natural limit just to hit a number.

| Source type | Expected yield | Typical pattern |
|---|---|---|
| **Technical interview / engineering talk** | **densest** — 3-5 strong findings with concrete file anchors | Run 3 (Codex/Bolin): 3 accepted findings + 1 security escalation. Interviews with engineers on specific systems often reveal architectural critiques that map directly to codebase gaps. |
| **Feature walkthrough / dev-focused demo** | dense — 3-4 findings with mix of code + template ideas | Run 1 (A2A Gateway): 4 accepted findings. Run 2 (Everything is a CLI): 4 accepted findings. Demos that show a specific workflow tend to produce at least one clear architectural finding. |
| **Product demo / competitor walkthrough** | **low + many catches** — 1-3 real findings, 5-10 "already existed" catches | Run 4 (Paperclip): 2 findings, **8 already-existed catches**. Product demos of competing systems are high signal for the host-first rule because every feature demonstrated is potentially "does personas have this?". Expect the catch count to exceed the finding count. |
| **Philosophical / forward-looking article or video** | low — 1-2 findings, mostly discovery-brief territory | Run 5 (Karpathy LLM Wiki): 2 accepted findings + 7 already-existed (the skill's own prior iteration had already implemented the core insight). Philosophical sources often produce narrow deltas against existing implementations. |
| **Product launch article** | low-medium — 1-3 findings including at least one scaffolding-shaped finding | Run 6 (Claude Managed Agents): 2 findings, one of which became a theoretical scaffolding handoff (Option C). Launch articles frequently describe gated/preview features that fit Option C. |
| **Specification / standard / RFC** | **medium findings + many catches**, and the findings are unusually *actionable* | Run 2026-08-13 (Agent Plugins 1.0.0): 4 findings / 6 catches, 2 shipped same-session. A mature codebase has usually built a spec's **features** (those become catches) and skipped one of its **invariants** — so **read the MUST/SHOULD/MAY table before the feature tour.** The prize on this source type is a constraint the repo never checked, not a capability it lacks. Distinct from a product-launch article: a spec has no roadmap to defer to, so nothing lands in Option C. |
| **Best-practices listicle** ("N rules for X") | **low findings + many catches**, ~1:3 | Run 2026-08-12 (12 Rules for Claude.md): 4 findings, **11 already-existed catches**. A listicle enumerates a canonical checklist, so against a mature repo most items resolve to catches and the value is the confirmation table plus two or three genuine deltas. Do NOT stretch for parity with the list's length — a 12-rule video is not a 12-finding run. Watch for the item the repo deliberately does the *opposite* of; that is a catch with a reason, not a gap (here: "always ask clarifying questions" versus a headless engine's act-autonomously directives). |
| **Blog post / raw text** | varies widely | Phase 2b and 2c work the same as 2a downstream; the yield depends on content density, not transport. |

**If the finding count feels low, check the source type first.** If the source is a product demo and you have 7+ catches, that's a successful run, not a failed one. Surface the catch count prominently in Phase 7 as the primary metric for low-finding runs.

---

## Phase 4: Relevance Filter

For each idea, score relevance against `.claude/codebase-context.md`:

- **High** — keywords clearly match a context group's keywords/description; specific files/entry points are obvious anchors
- **Medium** — partial keyword overlap or description similarity, no clear file anchor
- **Low / drop** — no plausible attachment point in any context group

**Drop all `Low` ideas.** Don't waste user attention on out-of-scope material.

**Scoring honesty — evidence caps the score.** Phase 4 scores are provisional keyword matches; they become final only after Phase 6. A finding may carry `Relevance: High` into Phase 7 **only if** Phase 6 actually read or grepped the anchor file(s) in this session and the finding cites the resulting `file_path:line` evidence. "Sounds applicable to personas" without a code read caps the score at `Medium` and the Evidence line must say `unverified — keyword match only`. Never present an unverified finding as High just because the source is compelling — the 2026-04-08 catalog-vs-runtime misframe came exactly from scoring on vibes instead of code.

If the focus hint was `code` / `templates` / `credentials`, drop ideas that don't match the chosen bucket (after Phase 5 reclassification).

---

## Phase 5: Bucket Classification

Re-evaluate each surviving idea and assign a final bucket. An idea may belong to **multiple** buckets — that's fine, present it once but flag all applicable buckets.

### Bucket A — Code Improvement
The idea suggests a change to existing code in personas. Examples:
- "Add request retry with exponential backoff"
- "Memoize this expensive computation"
- "Use IntersectionObserver instead of scroll listeners"

Required output: target file(s) under `personas/`, function/component name if known, evidence the gap exists.

### Bucket B — New Persona Template
The idea describes a new agent workflow that fits the `add-template` schema. Indicators:
- Mentions external services orchestration
- Has clear trigger → action → notification flow
- Could replace a manual repetitive process

Required output: template name, services involved, primary trigger, similar templates already in `scripts/templates/` (and why this isn't a duplicate).

### Bucket C — New Credential
The idea references an external service whose connector isn't in `scripts/connectors/builtin/`. Indicators:
- A specific tool/SaaS named that personas doesn't yet integrate
- The integration would unlock template ideas in Bucket B

Required output: service name, auth type if known, why personas needs it.

If an idea is a `template + credential` combo (a new template that requires a not-yet-existing credential), present it once, flag both buckets, and note that the credential must be added first.

---

## Phase 6: Evidence Gathering

For each surviving idea, gather concrete evidence to make the user's triage easy. Budget your tool calls — don't go deeper than necessary.

### Code bucket

**Step 1 — Host infrastructure first.** Before searching for the specific feature, grep for the *category of host infrastructure* the idea would attach to. Examples:
- HTTP endpoint idea? `Grep "axum|HttpServer|Router::new"` to find existing HTTP server modules
- Background job idea? `Grep "tokio::spawn|JoinHandle|Worker"` to find existing job runners
- Auth/middleware idea? `Grep "middleware|tower_http|from_fn"` to find existing middleware patterns
- New table idea? `Grep "CREATE TABLE.*<related_concept>"` in `migrations.rs`
- New CLI flag idea? `Grep "binary_candidates\|build_cli_args"` in `engine/provider/`

This catches existing-but-undocumented surface area in one grep. **A single discovery here typically reframes 2-4 findings at once** — what looked like "build new infrastructure" becomes "add routes to existing router" / "add column to existing table". Reframing changes both effort estimates and file anchors, so do it before deeper greps.

**Step 1b — Catalog vs runtime check.** Before scoring any finding about "tool surface", "prompt size", "connector count", or similar quantitative architectural critiques, verify the catalog count is NOT the same as the per-execution count. Personas examples:
- 87 connectors in the catalog ≠ 87 connectors in any execution. Each persona binds **0-3** connectors. Per-execution surface uses 0-3 as the denominator.
- 92 templates in the catalog ≠ 92 prompts the LLM sees. Each persona uses 1 template at most.
- N protocol blocks defined ≠ N injected per execution. Some are conditional on persona type, dev-tools mode, etc.

If the finding's premise depends on catalog count = runtime count, **the finding is wrong** — drop it or reframe before presenting. See `codebase-stack.md` Section 3 for the connector binding model.

**Step 1c — Framework vs plugin routing.** Before deciding the file anchor for a code finding, check whether it belongs in the **core engine** or in a **plugin**. Personas-the-framework is general-purpose; code/SDLC-specific features (worktree isolation, CLAUDE.md updates, repo scans, PR generation, build automation) belong in `src/features/plugins/dev-tools/` + `src-tauri/src/commands/infrastructure/dev_tools.rs`, NOT in the core engine. See `codebase-stack.md` Section 3, subsection "Personas framework vs `dev-tools` plugin". When in doubt: ask "would a non-coding persona benefit from this?" If no → plugin, not core.

**Step 2 — Then search for the specific feature.** Now grep for the actual thing the idea proposes (function name, env var, flag, table name).

**Step 3 — Read the anchor file.** `Read` the most relevant file(s) — limit to ~100 lines. Identify the exact `file_path:line_number` where the change would land. **For host-infrastructure verification, read enough to confirm the public API (~30 lines), not the implementation (~500 lines)** — token efficiency matters.

**Step 3a — Consult `docs/features/` when context is too coarse.** `codebase-context.md` is DB-derived and intentionally shallow — it gives keyword groups and file lists, not flow descriptions. When a finding lands inside a documented feature area (Home, Overview, Personas, Templates, Execution, Connections, Events, Recipes, Settings) or a plugin (Artist, Companion, Dev Tools, Drive, Obsidian Brain, Research Lab, Twin), open the matching `docs/features/<area>/README.md` (or `docs/features/<plugin>.md`) before doing wider greps. The doc names the UI entry point, primary user flows, backend command surface, and known gaps — frequently the exact attachment point is named there in one sentence and the grep round can be reduced or skipped. The doc-sync Stop hook in `.claude/CLAUDE.md` keeps these aligned with source within one PR, so they're current; do not infer staleness without a `git log` check.

When the finding spans multiple feature areas (e.g. an execution-runtime change that surfaces in Overview), read both relevant docs — the framing in one is rarely sufficient for cross-area work.

**Step 3b — If the finding adds a cap, budget, limit, or guard, find the existing one first.** Grep for a cap already applied to the *same material* (`budget`, `MAX_`, `LIMIT`, `truncate`, `pack_`) before choosing a mechanism. Two distinct failures this catches: (a) the cap already exists one layer down and the finding is void; (b) the cap exists but made the **opposite** design decision, so your implementation would be locally reasonable and globally inconsistent. Run 2026-08-12 hit (b) — a per-entry *truncation* with an announce-the-cut marker was written and reverted after reading `pack_by_budget`, which **skips** over-budget entries on the documented grounds that "a partial memory is worse than none". Reusing the existing packer made the change smaller and removed a duplicated constant instead of adding a competing one. Truncate-vs-skip, drop-oldest-vs-drop-lowest-ranked, and fail-vs-degrade are all decisions a codebase may have already made once.

**Step 4 — Drop if redundant.** If the gap doesn't actually exist (the codebase already does this), drop the idea.

**Step 4b — Read backgrounded tool output even when you re-ran it scoped.** A grep that times out and gets backgrounded is usually slow *because it covered more ground*. Re-run it scoped to stay unblocked, but read the original when it lands: on run 2026-08-12 the wide version contained one reference the scoped re-run had missed, which turned a single-module finding into a documented three-instance pattern and then into a shipped-template consequence. A superseded background result is not redundant.

**Step 4c — A capped grep proves presence, never absence.** Any claim of the form
"the codebase does not have X" must come from an **uncapped** search — no `head -N`, no
`| head`, no `head_limit` — or from a count (`grep -c`, `output_mode: "count"`). Ripgrep
and grep emit in path order, not relevance order, so a cap silently truncates exactly the
file whose name matches your concept: on run 2026-08-17 a `head -8` over `src-tauri/src/`
reported "no tray icon" because `src/tray.rs` sorted *after* eight `commands/**` matches
on the word "s**tray**". The run then told the user a subsystem was missing when it was
present, with the same confidence as its load-bearing claims.

This is the mirror of Step 4b and is easy to miss right after obeying it: that run read
its backgrounded wide grep to corroborate one absence claim, then made a second absence
claim one tool call later from a capped result without routing it through the same
discipline. Presence claims are safe to cap — one hit is one hit. Absence claims are not.
Before writing "zero hits" into Phase 7, re-run uncapped.

**Step 5 — Grounding check (per finding, before Phase 7).** Every code finding that will be presented as `High` must carry at least one `file_path:line` citation produced by a Read or Grep **in this session** — the line that proves the gap exists (or the host surface the change attaches to). If you can't produce that citation within budget, downgrade to `Medium` + `unverified` per the Phase 4 scoring-honesty rule; don't fabricate an anchor from the context map's file list.

**Security escalation rule:** When a grep against a file that exposes an HTTP, IPC, webhook, or external surface — **OR** that spawns a privileged subprocess (e.g. with `--dangerously-skip-permissions`) — returns **zero hits for auth/sandbox patterns** (`api_key|Authorization|Bearer|require_auth|middleware|sandbox|seatbelt|seccomp|landlock`), do NOT drop the finding as "no existing pattern". Instead, **escalate it to severity `CRITICAL` and re-label it as a security gap, not a feature add.** Open HTTP/IPC surfaces and unsandboxed privileged spawn sites are findings even when the user didn't ask about security — the source may not even mention security, but the codebase reality does.

**i18n impact check:** When a code finding touches frontend files (`src/**/*.tsx`), note whether it introduces new user-facing strings. If yes, mark it with `i18n: required` in the finding output and add an effort note: "New UI strings must go through `src/i18n/locales/en.json` + `useTranslation()`, translated into all 14 locales in the same change — see CLAUDE.md → Internationalization." This ensures the implementing CLI knows about the i18n cost upfront, not as a surprise during Phase 8 handoff execution. For findings that add backend status tokens displayed in the UI, note that `tokenLabel()` from `src/i18n/tokenMaps.ts` must be used instead of raw token strings.

### Template bucket
- **First** scan `codebase-catalogs.md` Template Catalog section for duplicates (faster than filesystem)
- If a similar entry exists by id/scope/services, drop the idea — note "duplicate of {id}"
- If unsure, `Read` the closest existing template JSON (1 file max from `scripts/templates/{category}/{id}.json`) to confirm
- **Boost priority** if the idea's category is marked as **sparse** in `codebase-catalogs.md` Coverage Analysis section
- For ideas requiring connectors NOT in the catalog, mark them as **combo** (template + credential, credential first)

### Credential bucket
- **First** scan `codebase-catalogs.md` Connector Catalog section for the service name
- If found, drop the idea — note "already exists as {name}"
- If not found, **boost priority** if the connector category is sparse
- Also verify the auth type is supported (compare against the auth distribution in Coverage Analysis)

---

## Phase 7: Present Findings

Print a single summary table followed by numbered detail blocks. **Before printing, run cluster detection (below) so the user can see natural bundles instead of a flat list.**

### Cluster detection

Before presenting, scan the surviving findings for clusters that should ship together:

- **Same file anchor** — multiple findings touching the same file (e.g. all 4 land in `engine/management_api.rs`) usually want a shared PR. Note the cluster.
- **Dependency edges** — finding B mentions a field/table/module that finding A would create. Note `depends on [N]`.
- **Security pairing** — an auth finding paired with an exposure/visibility finding. Neither makes sense alone (auth without exposure flag = every key sees everything; exposure flag without auth = anyone reaches public stuff). Always present these as a forced pair.
- **Protocol pairing** — a protocol-shape endpoint paired with a self-describing metadata endpoint (the metadata endpoint is the prerequisite). Always present these as a natural pair.

For each cluster, add a one-line note to the relevant findings: `Cluster: ships with [N, M] — recommended order: M → N`. This makes the user's triage decision a cluster decision, not a per-row one.

### Summary table

```
#  Bucket       Title                                          Relevance  File / Service
─  ───────────  ─────────────────────────────────────────────  ─────────  ──────────────────
1  code         Add retry with backoff to API proxy            High       src-tauri/src/engine/api_proxy.rs
2  template     Daily standup digest from GitHub PRs           High       (new template)
3  credential   Add Linear connector                           Medium     (new credential)
4  code+tpl     Webhook deduplication via idempotency keys     High       src-tauri/src/.../webhooks.rs
...
```

### Per-idea detail

For each row:
```
[N] {title}
    Bucket(s):    {bucket(s)}
    Source:       "{quote}" or [HH:MM:SS]
    Summary:      {2-3 sentences}
    Evidence:     {file_path:line actually read/grepped this session for code; similar templates for templates; or "unverified — keyword match only" (caps relevance at Medium)}
    Recommended:  {/add-template "..." | /add-credential "..." | edit {file}}
    Why it fits:  {which context group from snapshot it maps to}
    Aligns with:  {strong-pattern wikilink + canonical example, if any — else omit line}
```

---

## Phase 8: User Triage

Ask the user:
```
Which findings should I action? Reply with numbers (e.g., "1, 3, 4"),
"all", "none", or "ask" for a guided walkthrough.
```

For each accepted finding:

### Code bucket

**IN-SESSION EXECUTION IS THE DEFAULT.** Set on 2026-04-17 after observing the morning-handoff → evening-amendment → next-session-execution fragmentation pattern. Split sessions fragment the work: a handoff written at the end of session N accumulates amendments in session N+1 and finally gets executed in session N+2 — each hand-off is a place where context is lost, scope drifts, and on 2026-04-11 one such hand-off resulted in an entire session's code being wiped during a merge. **Execute in the same session that produced the findings, validate, and commit atomically per task.** This keeps the discovery → decision → implementation arc inside one context window where corrections are cheap.

**When in-session execution is NOT possible** (pick the fallback shape):

- **Context is critically tight** and the remaining budget cannot accommodate the edits + validation + commits.
- **Work is genuinely exploratory or multi-day** — requires specs that don't exist yet, external approvals, research into unknown systems.
- **Dependency is unavailable** — whitelist-gated API, preview product, credentials the dev team can't obtain (Option C territory).
- **User explicitly requests planning-only** — "prepare a plan, I'll execute later".

Do NOT fall back to a handoff because the work feels large. "Large" is a signal to break into smaller atomic commits, not to defer. Cross-language work (Rust + TS + i18n + migration in the same run) is still in-session-executable as long as validation passes per-task.

**Option A — Single isolated finding → execute + commit + optional todo (NEW DEFAULT)**
For one code finding with a clear `file_path:line` anchor, apply the edit, run the relevant validation (`npm run check` — ten gates incl. `census:check`, never a bare `tsc`+`lint` pair; plus `cargo check` if Rust changed), and commit with a `research:` prefix. Offer a follow-up todo via `/gsd-add-todo` only if the finding surfaces adjacent cleanup that is out of scope for this PR. Do NOT write the finding to Obsidian as a "noted but not implemented" item — that is the old default and it fragments the record.

**Option B — Clustered findings → in-session execution with atomic commits (NEW DEFAULT for 2+ findings)**
For 2+ clustered code findings:

1. **Present the full task plan inline** (same shape as the old handoff structure below) before executing, so the user sees what is about to happen.
2. **Execute in the recommended ship order** (risk-ascending: trivial constants first, complex cross-file work last).
3. **After each task, run the relevant validation**:
   - Every task → `npm run check` — **ten** gates in an `&&` chain incl. **`census:check`**, `tsc --noEmit`, `eslint src/`. Never a hand-rolled `tsc`+`lint` pair: the chain stops at the first failure, and `census:check` is the one most likely to fail a diff that compiles. See `.claude/CLAUDE.md` → "PR self-review".
   - Rust changes → `cargo check` in `src-tauri/`
   - i18n changes → `npm run check:i18n:strict` (no-gap gate; use the translate-extract/merge pipeline from CLAUDE.md to close gaps)
4. **Commit atomically per task** with `research: <short task title>` prefix, Co-Authored-By footer, and a body that explains the why.
5. **If validation fails for a task**, fix the issue inline before moving to the next task. Do NOT stack failing commits. Do NOT use `--no-verify` or `--amend`.
6. **If a task genuinely cannot be completed in-session** (e.g., hits a real blocker), commit the completed tasks, then write a handoff for the remainder — do not discard the completed work.

The inline task plan should include:

- **Why this matters** — one-paragraph context (what problem, what infrastructure already exists)
- **Goal** — numbered list of the bundled findings as deliverables
- **Non-goals** — explicit "do NOT do these" list (deferred findings, scope creep traps, layers not to touch). Even in-session execution benefits from explicit non-goals; they keep the execution focused.
- **Dependency graph & order** — which tasks ship together, which depend on which
- **Per-task spec** — for each task: file path & line anchor, schema/migration SQL, struct definitions, function signatures, acceptance criteria
- **Cross-cutting concerns** — convention compliance (point at `.claude/CLAUDE.md`), security defaults, backward compat constraints, tests to add. **If any task touches frontend code (`src/**/*.tsx`), honor BOTH:**
  - Typography contrast / muted-text antipattern rule from CLAUDE.md UI Conventions.
  - i18n contract: all user-facing strings through `useTranslation()` + keys in `src/i18n/locales/en.json`, translated into every locale in the same change. No hardcoded English in JSX, placeholder, title, or aria-label. Backend status tokens via `tokenLabel()` from `src/i18n/tokenMaps.ts`. Error messages via `resolveErrorTranslated()` from `src/i18n/useTranslatedError.ts`.

Record the commit SHAs in the Research note frontmatter (`commits: [<sha1>, <sha2>, ...]`) and in the Phase 11 final summary. The Research note replaces the handoff file as the canonical per-run artifact.

**Option B-Design — Design-then-execute (when shape requires exploration)**
Pick this when the user replies to Phase 8 with phrases like "propose approaches", "design first", "what are the options", "scan and propose", "three different approaches", or otherwise signals that the finding's shape is ambiguous and needs exploration before code lands. The shape is: explore → user picks → write a concrete design doc → **immediately execute** against it in the same session.

Steps:
1. **Scan once more.** Run a focused round of codebase evidence gathering beyond Phase 6 to ground the approaches in concrete file anchors. Do not skip this — without it, the approaches read as generic and the user cannot distinguish them.
2. **Present 2-3 approaches** with tradeoff tables (✅ benefits / ⚠️ risks per approach) and effort estimates. Each approach must name actual file paths and existing infrastructure it would attach to or extend. Generic approaches that could apply to any codebase are a smell — the source-grounded option is the one the user picks.
3. **Wait for the user's pick.** Do NOT proceed to design-doc writing on speculation; the user may refine the framing or merge approaches.
4. **Write a co-located `DESIGN.md`** next to where the code will land (e.g. `src/features/<area>/<sub_feature>/DESIGN.md`), NOT in `.planning/handoffs/`. The co-location matters: a future session reading the code finds the design rationale next to it. If the location is genuinely ambiguous (multi-area changes), use `.planning/research/{date}-{slug}.md` instead.
5. **Continue IMMEDIATELY to in-session execution** against the design. Do NOT stop at the design doc and ask for approval. The user already approved the approach in step 3; the design doc is the implementation contract, not a second decision gate.
6. **Treat the design doc as a working artifact.** If implementation reveals a constraint that invalidates part of the design (e.g., the proposed schema conflicts with an existing index), AMEND the design doc inline and continue with the new shape. Don't pause for re-approval on minor adjustments — only pause if the change is structural enough that the user would have picked a different approach.
7. **Atomic commits per PR step in the design's rollout plan.** A 5-PR rollout = 5 atomic commits. Validation runs per commit (cargo check / tsc / lint / locale parity), same rules as Option B.

**Why this is its own option, not just a variant of B:** A regular Option B finding has a clear `file_path:line` anchor where the change lands. A B-Design finding starts with no clear anchor — the work is partly figuring out what to build. The exploration step is non-trivial (3+ tool calls of codebase scan), and writing the design doc is real work (typically ~1-2 KLOC of markdown). Wrapping it in a labeled option lets future runs reuse the pattern without re-discovering it.

**Anti-pattern:** writing a design doc and stopping there ("design ready for review"). That fragments the work across sessions and re-introduces the merge-loss risk Phase 13 was designed to prevent. The 2026-04-17 split-session lesson applies here too — the design exploration and the implementation belong in one context window.

**When this option does NOT apply:** if the user accepts a finding with a clear file anchor without asking for approaches, just run Option A or B. Don't volunteer an exploration round when none is needed.

**Option B2 — Implementation-ready handoff plan (FALLBACK when in-session execution is impractical)**
This was the old Option B default. It is now a fallback. Use ONLY when one of the "when in-session execution is NOT possible" conditions above is met. When written, use the structure from Option B above (Why this matters, Goal, Non-goals, Dependency graph, Per-task spec, Cross-cutting concerns, Final acceptance checklist, What to do if you get stuck, Out of band) and save to `.planning/handoffs/{YYYY-MM-DD}-{slug}.md`.

The handoff plan must be **self-contained** — readable without the conversation that produced it. The implementing CLI will not have access to this skill's context.

Record the handoff path in the Research note frontmatter (`handoff: .planning/handoffs/{date}-{slug}.md`) and in the Phase 11 final summary.

**Do NOT default to Option B2.** Every time a handoff is written instead of executed, there is a risk the work never lands or lands fragmented across multiple sessions. The 2026-04-17 same-day morning-handoff → evening-amendment cycle is the canonical cautionary tale — the same findings took two research sessions and a third execution session to fully land when a single session would have sufficed.

**Option C — Theoretical scaffolding handoff (gated/preview/whitelist-dependent features)**
Same structure as Option B, BUT with a much stricter non-goals section. Use this when the accepted finding depends on an external dependency that isn't available yet: whitelist-gated APIs, preview products, unreleased SDKs, features behind a private beta.

Distinguishing characteristics vs. Option B:
- **Non-goals section explicitly forbids any real integration attempts.** Example phrasing: *"Do NOT make any HTTP calls to {external host}. Not in tests, not in examples, not in commented-out code."* and *"Do NOT hardcode endpoint URLs before the API is publicly documented."*
- **Implementation style is scaffolding only:** stub structs/traits, settings keys with no defaults, `Err(AppError::NotImplemented(...))` returns, variant added to enums with dispatch points returning NotImplemented. The compile passes; no runtime behavior is exercised.
- **Every stub point gets a `TODO({feature-name}-{reason})` marker** (e.g., `TODO(managed-agents-whitelist)`) so a future CLI session can grep for all the breadcrumbs and finish the work when access is granted.
- **Tests only cover the deterministic stub path** (assert `NotImplemented` is returned). No integration tests; no fixtures that imply real API shape.
- **Out-of-band section lists "what to do when access is granted"** as a concrete checklist: grep for the TODO marker, flesh out stub methods, add UI surface, update docs.
- **Small Cargo.toml / deps additions are allowed only if** the dependencies are already present for other reasons. Do NOT add new dependencies that only the stub would use.

When to pick Option C over B:
- The source mentions a product in public beta / research preview / whitelist gate
- The API spec isn't publicly documented
- Authentication credentials for the external system aren't available to the dev team
- The user explicitly says "prepare theoretically" or "scaffold for future"

Run 6 (2026-04-08, Claude Managed Agents) produced the first handoff in this shape. It's a real category — codify it.

**Option D — Just record, no further action (escape hatch only)**
For findings the user wants to think about without acting on yet, write them into the Research note only. No todo, no handoff. The Research note serves as a future search target. This is the escape hatch, not a default — prefer B or C for any finding concrete enough to have a file anchor.

**Discovery briefs — de-prioritized.**
Earlier iterations offered a "discovery brief" shape for findings that needed architectural analysis before implementation. Run 2 wrote one; run 3's candidate was descoped; run 6's candidate was converted into a theoretical-scaffolding handoff (Option C) instead. Pattern: users prefer concrete plans (even stubs) over pure analysis documents. **Do NOT propose a discovery brief as a first-class option.** If a finding seems to need one, first ask whether it can be expressed as Option C (scaffolding) — that captures the architectural intent in compilable code. Only write a discovery brief as a last resort when there's genuinely nothing code-shaped to scaffold (e.g. a pure product-direction question). If written, place at `.planning/research/{date}-{slug}.md`.

### Template bucket
Auto-invoke `/add-template` with a pre-filled description derived from the finding's title + summary + recommended services. Pass the description as the first user message inside the skill so the user doesn't have to retype it.

### Credential bucket
Auto-invoke `/add-credential` with the service name pre-filled.

### Combo bucket
If both template + credential are flagged, run `/add-credential` first, then `/add-template`. Confirm with the user before chaining.

For each declined finding (in the user's reply or by omission), record the number for Phase 10.

---

## Phase 9: Persist to Obsidian Research Note

Write `C:/Users/kazda/Documents/Obsidian/personas/Research/{YYYY-MM-DD}-{slug}.md`.

Where `{slug}` is derived from the source: video title, article title, or first 4 words of raw text. kebab-case, max 40 chars.

### 9a. Duplicate defense (before writing)

The vault has dozens of prior Research notes; the same idea often arrives via multiple sources (e.g. two videos covering the same Claude Code release). Before writing, **Grep the vault's `Research/` and `Lessons/` folders for each surviving idea's key terms** (tool name, technique name, distinctive phrase — 1 grep with alternation is enough). For each hit, skim the matching note's frontmatter/headings:

- **Same idea, previously accepted/actioned** → do NOT re-present it as new. Record it in this run's note as a one-liner under `## Prior art` with a wikilink (`covered in [[2026-04-15-claude-code-routines]] — accepted, no delta`) and count it with the `already_existed` catches in Phase 11.
- **Same idea, previously declined/descoped** → surface the prior decision in Phase 7 ("previously declined in [[note]] because X — reconsider?") instead of presenting it fresh. (Phase 3's `descoped-reopenable.md` check covers the tracked subset; this grep catches the untracked rest.)
- **Related but with a real delta** → keep the finding, and add the wikilink under `## Cross-references` naming the delta.

Ideally run this check before Phase 7 (so the presentation is already deduplicated); at the latest, run it here before the note is written. Never write two vault notes that restate the same idea without linking each other.

Frontmatter + body:
```markdown
---
date: 2026-04-07
source_type: youtube|article|text
source_url: <url or "pasted">
source_title: "<video/article title>"
focus: all|code|templates|credentials
total_extracted: 12
total_after_relevance: 7
accepted: [1, 3, 4]
declined: [2, 5, 6, 7]
buckets: { code: 4, template: 2, credential: 1 }
web_augmentations:        # Phase 2.5 — omit if phase did not run
  - { name: "ToolName", url: "https://...", kind: "tool" }
---

# {Source title}

**Source:** [{title}]({url})
**Run:** {timestamp}

## Summary
{2-3 sentence overview of what this source covered}

## Extracted Ideas

### [1] {title}  ✅ accepted → {action taken}
**Bucket:** code
**Source anchor:** "{quote}" / [HH:MM:SS]
**Evidence:** `src/foo/bar.ts:42`
**Notes:** {anything from triage}

### [2] {title}  ❌ declined
**Bucket:** template
**Source anchor:** ...
**Evidence:** ...
**Decline reason:** _to be filled in Phase 10_

...

## Cross-references
- Related patterns: [[Patterns/user-preferences]]
- Prior runs touching same area: {wikilinks to other Research notes if any}
```

---

## Phase 10: Self-Reflection (the learning loop)

This phase makes the skill smarter over time. Do not skip it.

### 10a. Ask why

For declined findings, ask the user **once**, in a single batched question:
```
Help me improve. For these declined items, why did you skip them?

  [2] {title}
  [5] {title}
  [6] {title}
  [7] {title}

You can answer per-item ("2: too vague, 5: already planned") or with a
single reason that covers all of them. Type "skip" to move on.
```

If the user types `skip`, jump to 10c.

### 10b. Append to Lessons

Write/append to `C:/Users/kazda/Documents/Obsidian/personas/Lessons/{YYYY-MM-DD}-research.md` (Edit-append, never Write-replace — shared-by-date file, see the 2026-04-14 iteration-log entry).

**Write it LATE, and re-read before the Phase 11 summary.** Following the Edit-append rule
protects other sessions from you; it does not protect you from them. On 2026-08-13 a
concurrent session `Write`-replaced this file mid-run and erased a block that had been
correctly Edit-appended minutes earlier. Recovery was only possible because the loss
surfaced in the same turn and the content was still in context. Two mitigations, both
cheap: (a) write this block as late in the run as it can go, so the exposure window is
short; (b) before printing the Phase 11 summary, re-read the Lessons file and confirm your
block is still present — restore it by Edit-append (never Write, which would repeat the
offense in the other direction) if it is gone.
```markdown
## Run: {timestamp} — {source title}

Source: {url}
Accepted: [1, 3, 4]
Declined: [2, 5, 6, 7]

### Decline reasons
- [2] {reason}
- [5] {reason}
- [6] {reason}
- [7] {reason}

### Self-reflection
- What I extracted that resonated: {pattern}
- What I extracted that didn't: {pattern}
- Tools I should use more / less next time: {observation}
```

The "Self-reflection" block is your own assessment — not the user's — written as a brief note about what worked in this run vs. what didn't.

### 10c. Update Research note

Backfill the Research note from Phase 9 with the decline reasons.

### 10d. Pattern promotion check

Read all files in `Lessons/` and look for repeated decline reasons:
- If the same reason (or close synonym) has appeared in **3+** runs, propose adding it to `Patterns/user-preferences.md`.
- Show the proposed pattern to the user and ask: "I've seen this 3+ times — promote to permanent rule?"
- If yes, append to `Patterns/user-preferences.md` as a new bullet with date and source-run links.

### 10e. codebase-stack.md update check

Did this run discover a **structural fact about the codebase** that future runs would need to know? Examples:
- A misreading the user corrected (e.g. catalog vs runtime distinction)
- A plugin or module the skill didn't know existed (e.g. a separate cloud client, a dev-tools plugin)
- An architectural boundary that determines where findings should be routed (e.g. framework vs plugin)
- A security model invariant that affects threat assessment

If yes, **edit `codebase-stack.md`** with the new fact. Tag the addition with the run date and source so the iteration log can reference it. The file is hand-curated and `/refresh-context` does NOT regenerate it — your edits are durable.

If no, skip this step.

This step exists because runs 2 and 3 both discovered structural facts the skill needed but didn't have. The pattern: a finding gets misframed, the user corrects, the correction is broader than just "this run was wrong" — it's a fact every future run needs to know. Capturing it in `codebase-stack.md` prevents the same misframe in run N+1.

### 10f. Descoped-but-reopenable tracking

For each finding that was descoped (not declined, not accepted — descoped because of an external blocker like a hard technical problem, a missing dependency, or an unavailable product), record it in `C:/Users/kazda/Documents/Obsidian/personas/Patterns/descoped-reopenable.md`. This is a separate file from `Patterns/user-preferences.md` — user preferences are permanent rules; descoped-reopenable entries are conditional waits.

File format (create if missing):

```markdown
# Descoped-But-Reopenable Findings

Findings that were descoped due to an external blocker but may become viable
later when the blocker clears. Phase 3 of future runs reads this file and
surfaces any matching items as "previously descoped, reconsider?" candidates.

## Entries

### {YYYY-MM-DD} — {finding title}
- **Source run:** {research note wikilink, e.g. [[2026-04-08-paperclip-hire-agents]]}
- **Original descope reason:** {verbatim quote from the user or self-assessment}
- **Blocker:** {what needs to change for this to become viable}
- **Reconsider trigger:** {concrete signal to watch for — e.g. "Anthropic ships X feature", "personas adds Y capability", "OSS project Z hits 1.0"}
- **Related findings:** {wikilinks to any related Research notes}
```

**When to add an entry:** if during Phase 8 the user descopes a finding AND the decline reason names a specific external blocker (not "no business need" or "too niche" — those are permanent rejections). The trigger for adding an entry is a phrase like *"come back when..."*, *"we can't do this until..."*, *"the platform doesn't support this yet..."*, or a technical problem the user explicitly acknowledges as unsolved.

**When NOT to add:** descopes based on priority ("not now"), scope ("too big"), or permanent preference ("we don't like this pattern"). Those belong in Lessons or user-preferences.

**Example from run 4 / run 6:** Paperclip run 4 surfaced "maximizer mode" (run-until-done semantics) which was descoped because of the goal-verification problem. Run 6 (Claude Managed Agents) observed that Anthropic solved the same problem externally. A properly-tracked descoped-reopenable entry from run 4 would have flagged this in run 6's Phase 3 automatically. **Write the entry now even if the blocker never clears — the cost of an unused entry is small; the cost of missing a reopen opportunity is a silently-missed finding.**

**Cross-check on future runs (Phase 3):** when reading `descoped-reopenable.md`, check each entry's "Reconsider trigger" against the current source. If the source describes a solution to the blocker, surface the entry in Phase 7 as a revived candidate next to the new findings.

**Cleanup:** when a descoped-reopenable entry is eventually accepted and actioned in a future run, remove it from the file (or move it to a "resolved" section at the bottom with the run date and handoff path). Don't let the file grow indefinitely.

---

## Phase 11: Final Summary

Print:
```
Research run complete.

  Source:       {title} ({source_type})
  Extracted:    {N} ideas
  After filter: {M} relevant
  Accepted:     {K} ({list})
  Declined:     {L} ({list})

  Already existed:  {A} (caught by host-first rule — see list)
  Descoped-reopenable: {D} (tracked in Patterns/descoped-reopenable.md)

  Actions taken:
    - /add-template invoked: {N} times ({names})
    - /add-credential invoked: {N} times ({names})
    - Implementation plan handoffs written: {N} ({paths})
    - Theoretical scaffolding handoffs written: {N} ({paths})
    - /gsd:add-todo invoked: {N} times
    - Findings logged for later: {N} (in Obsidian Research note only)

  Already-existed catches:
    {for each catch, one line: "{candidate title} → already at {file:line}"}
    {if none: "none"}

  Files updated:
    + Obsidian/personas/Research/{date}-{slug}.md
    + Obsidian/personas/Lessons/{date}-research.md
    {if handoff plan written:}
    + .planning/handoffs/{date}-{slug}.md
    {if pattern promoted:}
    ~ Obsidian/personas/Patterns/user-preferences.md
    {if descoped-reopenable entry added:}
    ~ Obsidian/personas/Patterns/descoped-reopenable.md
    {if codebase-stack.md updated in Phase 10e:}
    ~ .claude/codebase-stack.md

  Source-type yield:  {expected vs actual for this source type — see Phase 3 calibration table}
  Snapshot freshness: {fresh | stale by N commits — consider /refresh-context}
  Cache:              {cleaned | n/a (Phase 2b/c source) | residue at .research-cache/<id>.* — see Lessons cache_cleanup_skipped note}
  Commit: {filled in by Phase 13 — short SHA + subject, or skip reason}
```

**Surface `already_existed` prominently when the finding count is low.** A product demo run that extracts 2 findings + 8 catches is a high-yield run — frame it that way. Do not let the user read "only 2 findings" as a failure when the real output is "8 existing features confirmed + 2 real gaps found".

---

## Phase 12: Release Log Update ("What's New") — optional

After Phase 11's summary, offer to log accepted findings into the in-app
release notes ("What's New" view in the desktop app). This is what makes the
work visible to future-you, other contributors opening the app, and — most
importantly — **the actual users** of the desktop app, who will read these
strings as news, not engineering logs.

**Skip the phase entirely** if zero findings were accepted in Phase 8 —
there is nothing to log.

**Critical rule before you start writing anything:** the release log is
**user-facing news**, NOT an internal changelog. The voice rules in
`.claude/CLAUDE.md` → "UI Conventions → Internationalization → Voice for
user-facing copy" apply to every word you write here. If you find yourself
typing a file path, a Rust struct name, an env var, or a `.planning/handoffs/`
reference, you have already failed — go back and rewrite as impact + benefit.

### 12a. Read the release config

Read `src/data/releases.json`. Identify:
- `config.active` — the version that the in-app view opens by default
- the matching release object inside `config.releases`
- how many items it already contains
- the highest existing item id in that release (for ID generation)

If the file is missing or unparseable, warn (`release log not found, skipping
Phase 12`) and stop. Do **not** create the file from scratch — its existence
is a project-level decision, not the skill's call.

### 12b. Locate the i18n folder

Read the directory listing of `src/features/home/components/releases/i18n/`.
There should be exactly 14 locale files (`en.ts, cs.ts, de.ts, es.ts, fr.ts,
ja.ts, ko.ts, zh.ts, ar.ts, hi.ts, ru.ts, id.ts, bn.ts, vi.ts`) plus
`useReleasesTranslation.ts`. Read `en.ts` to learn the namespace shape — the
items live under `whatsNew.releases.{version}.items.{itemId}` with `title`
and `description` keys.

If any locale file is missing, warn loudly:
```
Locale file {lang}.ts is missing — refusing to write a partial set.
The "What's New" view loads via direct property access; missing keys crash
the UI. Restore the file or skip Phase 12.
```

### 12c. Ask the user

Print:
```
Add accepted findings to the release log?
Active release: {version} — currently {N} item(s).

Reply with numbers from the accepted list (e.g., "1, 3"), "all", or "none".
```

Use the **same numbering** as the Phase 7 summary table so the user does not
have to re-translate. Only accepted findings are eligible — declined ones are
implicitly excluded.

If the user replies `none` (or empty), skip to Phase 12g (still confirm
"unchanged" in the summary).

### 12d. Build structural items for `releases.json`

For each chosen finding, build the structural metadata only:

```json
{
  "id": "{next-numeric-id}",
  "type": "{inferred type}",
  "status": "completed",
  "added_at": "{today YYYY-MM-DD}"
}
```

**No `title`, `description`, `summary`, `label`, or `source` fields.** Those
are user-facing strings that live in the i18n locale files, not in JSON. The
JSON is structural metadata only — versions, types, statuses, dates, ids.

**Type inference rules** (in order — first match wins):
1. Finding was escalated to severity `CRITICAL` by the Phase 6 security
   escalation rule → `"security"`
2. Finding's bucket is `code` AND title/summary clearly describes a bug fix
   (keywords: "fix", "bug", "regression", "incorrect", "leak") → `"fix"`
3. Finding introduces a backwards-incompatible change (keywords: "breaking",
   "remove", "rename", "drop column") → `"breaking"`
4. Finding adds documentation only → `"docs"`
5. Otherwise → `"feature"`

**Item ID convention**: simple incrementing strings — find the highest
existing numeric id in `release.items` (`"1", "2", "3", ...`) and increment.
If no items exist yet, start at `"1"`. The id is what links the JSON
structural entry to its i18n content.

Append the new items to the **end** of `release.items` so they appear last
within their type group in the UI (the changelog view groups by type but
keeps within-type ordering stable).

### 12e. Build user-facing content for the i18n files

For each chosen finding, draft a `{ title, description }` pair in **English**
following the user-facing-news voice:

- **Title (≤ 8 words):** lead with the user benefit. Imperative or noun
  phrase, NOT a technical summary. Examples:
  - ❌ "Add Bearer token middleware to /api routes"
  - ✅ "Safer access for the desktop app"
  - ❌ "Implement A2A JSON-RPC handler"
  - ✅ "Open your agents to other AI tools"
- **Description (1-3 short sentences):** explain what the user can now do
  and why they would care. NO file paths, NO module names, NO version-bump
  details, NO `.planning/handoffs/` references, NO Rust/TS jargon. Examples:
  - ❌ "Adds external_api_keys table, Bearer token middleware on the
       management HTTP API, gateway_exposure column on personas..."
  - ✅ "Personas can now talk to other AI tools through a shared protocol.
       Pick exactly which agents you want to share, and protect them with
       access keys you control — your private agents stay private by
       default."

**The translation test:** read your draft and ask "would a non-developer
who has never seen the codebase understand this and care about it?". If the
answer is no, rewrite.

### 12f. Write content to ALL 14 locale files

This is the i18n contract from `.claude/CLAUDE.md`: every key in `en.ts`
must exist in every other locale file. Skipping any file breaks the UI for
that language at runtime.

For each new item, for each of the 14 locale files:

1. Read the file.
2. Locate the `whatsNew.releases.{version}.items` object. (If the release
   itself is new, you also need to add `releases.{version}` with `label`,
   `summary`, and an empty `items` object. Use the version string as the
   default label, and a one-line summary.)
3. Append the new item id with the English `title` + `description` pair you
   drafted in 12e.
4. For non-English locale files, ALSO ensure the file has a top-of-file
   `// TODO(i18n-{lang}): translate from English placeholders` marker. If
   the marker is already there, leave it. If it's missing, add it.
5. Write the file back, preserving 2-space indentation and the existing
   field ordering.

**Do not attempt to translate the strings yourself.** Write English
everywhere. The TODO marker is the signal that human translation is pending.

**Validate before writing:** after building the new content for all 14
files in memory, double-check that:
- Every file gets the same set of new keys
- The id exists in `releases.json` AND in every locale file's items map
- No locale file has been skipped

### 12g. Write the JSON back

Write the updated `releases.json` with:
- Two-space indentation
- Trailing newline
- Field ordering inside each item (`id, type, status, priority, sort_order,
  added_at`) for diff-friendliness

### 12h. Confirm

Confirm with a one-line print:
```
Release log updated: {N} item(s) added to {version}.
  - releases.json (structural)
  - {14} locale files (English content + TODO markers preserved)
```

If the user replied `none`, print:
```
Release log unchanged.
```

### 12i. Add to the Phase 11 summary footer

Append a `Release log:` line to the existing Phase 11 printout (re-print
the summary so it stays canonical):

```
  Release log: {N} item(s) added to {version} (en + 13 locale placeholders)
                | unchanged
```

---

## Phase 13: Atomic Commit (MANDATORY — prevents merge loss)

**Why this phase exists**: On 2026-04-11, a merge without recovery options wiped out an entire research session's worth of code — Task Runner depth presets, DevProject monitoring fields, event registry entries, TaskOutputPanel markdown toggle, and more. The fixes had to be manually recreated from the conversation transcript because no commit had captured them. **Never again.** Each research run commits its own output at the end, so git is the recovery mechanism when anything else fails.

This phase runs at the very end of a research session after Phases 10–12 have completed. It is **non-negotiable** except in the two explicit skip conditions below.

### 13a. Determine if there are changes to commit

Run `git status --porcelain` to see uncommitted changes. If the output is **empty**, skip Phase 13 entirely and print `No changes to commit.` in the final summary. This covers the "accepted: none" branch where nothing was actioned.

### 13b. Review what will be committed

Run `git status` and `git diff --stat` to see the full set of changes. The user will see this output as part of the skill flow. **Look for unexpected files** — anything outside the expected scope should raise a warning:

- **Expected scope for a research run:**
  - Any files touched by accepted Phase 8 findings (if the user chose Option B/C and the implementation already happened in the same session, or if the user told the skill to "implement right away")
  - `.planning/handoffs/{date}-{slug}.md` (if a handoff was written)
  - `src/data/releases.json` + all 14 locale files under `src/features/home/components/releases/i18n/` (if Phase 12 ran)
  - The Obsidian vault is **outside the repo**, so it should NOT appear in git status
- **Unexpected files that warrant a pause:**
  - Files under `node_modules/`, `target/`, `.vite/`, build artifacts
  - `.env`, `credentials.json`, anything that looks like secrets
  - Files from feature areas completely unrelated to any accepted finding (suggests stale edits from a different session)

If unexpected files are present, **print them to the user and ask** whether to include them in the commit or leave them uncommitted. Don't auto-include anything suspicious.

### 13c. Stage only the in-scope files

Use **explicit `git add <path>` per file**, NOT `git add -A` or `git add .`. This avoids accidentally staging secrets or unrelated drift. Build the file list from:

1. The handoff path (if Phase 8 Option B/C ran)
2. The files edited by an in-session implementation (if the user said "implement right away")
3. `src/data/releases.json` + all 14 locale files (if Phase 12 ran)
4. Any new files created during the run (`sub_*/` directories, new Rust modules, new i18n keys)

### 13d. Write the commit message

Use this exact template via HEREDOC so multi-line formatting is preserved:

```bash
git commit -m "$(cat <<'EOF'
research: {short-title-of-source}

Source: {url-or-pasted}
Accepted: {N} finding(s) ({comma-separated-titles})

{optional 1-2 line summary of what was implemented or handed off}

{if handoff written:}
Handoff: .planning/handoffs/{date}-{slug}.md

{if /add-template or /add-credential ran:}
Catalog: /add-template {names} | /add-credential {names}

{if Phase 12 ran:}
Release log: {N} item(s) added to {version}

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

**Rules for the commit message:**
- First line prefix **must be `research:`** — this identifies research-run commits in `git log` and makes them easy to filter
- Short title = the source video/article title trimmed to ≤50 chars, lowercased
- **Never include file paths** in the commit body — those are in `git diff`; the message is about *why*
- **Never use `--no-verify`** — let pre-commit hooks run. If a hook fails, fix the issue, re-stage, and create a NEW commit (never `--amend`)
- **Never skip signing** — the Co-Authored-By line is required

### 13e. Handle commit failure

If the commit fails (pre-commit hook rejection, lint errors introduced by an in-session implementation, etc.):

1. Print the failure reason to the user
2. Do NOT retry with `--no-verify`
3. If the failure is fixable (e.g., TypeScript error in a file the skill wrote), **fix it inline** and create a new commit with the same message
4. If the failure is NOT fixable in the current session (e.g., hook requires manual intervention), print:
   ```
   ⚠️ Commit failed. Changes are staged but NOT committed.
   Research outputs are safe in Obsidian vault, but code changes
   are vulnerable to merge loss until you commit manually.
   Run: git commit --message "research: <title>"
   ```
5. Still write the Research note — never sacrifice the learning loop because of a commit failure

### 13f. Skip conditions

Phase 13 has exactly **two** skip conditions. Everything else is non-negotiable.

**Skip 1 — No changes:** Phase 13a found an empty `git status --porcelain`. Nothing to commit. Print `No changes to commit.` and move on.

**Skip 2 — User explicitly opts out:** The user typed one of `--no-commit`, `no commit`, or `skip commit` in the original `/research` invocation OR as a response to Phase 8 triage. In this case, print:
```
⚠️ Skipping commit per user request.
Changes are uncommitted and vulnerable to merge loss until you commit manually.
```

**NOT a skip condition:** "I'll commit manually later." Do not take the user's word for this — the whole point of Phase 13 is to make the commit happen in-session before context is lost. If the user expresses this preference, gently remind them that "later" turned into "lost work" on 2026-04-11, and ask again whether to commit now.

### 13g. Update the Phase 11 summary

Append a `Commit:` line to the final printout (re-print the summary so it stays canonical):

```
  Commit: {short-sha} — research: {short-title}
           | skipped (no changes)
           | skipped (user opted out)
           | ⚠️ commit failed — see above
```

This gives the user one line to verify the whole run is safely captured in git before they close the session.

### 13h. Deregister from the Active-Runs Ledger

Run the script — it finds your entry, rewrites its status and moves it under
`## Recently completed` in one call:

```bash
node scripts/active-runs.mjs complete --slug <slug> --status "completed (commit: <short-sha>)"
```

`--status` is one of:

- `completed (commit: <short-sha>)` — Phase 13 successfully committed.
- `aborted (skip 1: no changes)` — Phase 13a found no changes.
- `aborted (skip 2: user opted out)` — Phase 13f skip 2 fired.
- `aborted (commit failed — see Phase 13e)` — commit failed and was not recovered in this session.

If your edit to `active-runs.md` happens AFTER Phase 13's commit, that's fine — the ledger update lands as an uncommitted file in the working tree, ready to be committed by the next session that ships work. (This avoids a chicken-and-egg of "needing to commit the deregister before the commit it references exists".)

`node scripts/active-runs.mjs doctor` reports structural damage — duplicate `## Active`
sections, entries past the 14-day window, and runs still marked `started` that nobody
closed. It only reports; trimming stays a human call, because other sessions are reading
this file live.

If your run aborted before reaching Phase 13 (e.g., the user terminated mid-run), your `## Active` entry stays — the next session reads it as stale (>2h old) and surfaces it to its user. That's the recovery path; don't try to write a deregister from a half-finished state.

---

## Error Handling

| Failure | Response |
|---|---|
| `.claude/codebase-context.md` missing | Stop. Tell user to run `/refresh-context`. |
| `yt-dlp` missing | Stop with install instructions. |
| YouTube has no auto-subs | Ask for manual transcript paste or alternate source. |
| `WebFetch` returns paywall / 403 | Ask user to paste the article text. |
| Source text <300 words | Report insufficient content. Stop. |
| Fewer than 2 ideas survive Phase 4 | Report "no relevant ideas found in this source for personas." Still write a stub Research note so the source isn't re-harvested. |
| Obsidian vault path missing | Run Phase 0 bootstrap, don't fail. |
| `/add-template` or `/add-credential` invocation fails | Report which one, save its description into the Research note as "deferred", continue. |
| `src/data/releases.json` missing or unparseable | Print `release log not found, skipping Phase 12` and stop the phase. Do NOT auto-create the file. |
| Phase 13 commit fails (pre-commit hook, lint, etc.) | Try to fix inline and re-commit. If unfixable, print the warning from Phase 13e and leave changes staged. Never use `--no-verify`. |
| Phase 13 detects unexpected files in `git status` | Ask the user before staging. Never auto-include suspicious paths (`node_modules/`, `.env`, `target/`, etc.). |

---

## Safety Rules

- **Never auto-edit personas source code.** Code findings always go to the Research note for human review.
- **Never** invoke `/add-template` or `/add-credential` without explicit user acceptance in Phase 8.
- **Never** skip Phase 10 unless the user typed `skip` — the learning loop is the whole point.
- The Obsidian vault is the source of truth for memory between runs. Do not duplicate this data into other locations.
- **Phase 12 is the only place** the skill writes to `src/data/releases.json` AND to any file under `src/features/home/components/releases/i18n/`. Never touch them from any other phase. Never write items the user did not explicitly accept in Phase 8 → Phase 12c.
- **Never write English directly into a `.tsx` literal** anywhere in the codebase. Per `.claude/CLAUDE.md` → Internationalization, every user-facing string lands in all 14 locale files. If a Phase 8 handoff plan would touch frontend code, the "Cross-cutting concerns" section MUST instruct the implementing CLI to follow the i18n contract (English first, then placeholders + TODO markers in the other 13).
- **Never put technical jargon in user-facing copy.** Release notes are news, not engineering logs. Voice rules in CLAUDE.md → "UI Conventions → Internationalization → Voice for user-facing copy". Apply them in Phase 12e *before* writing anything.
- **Phase 13 is mandatory.** Every research run ends with a commit unless there are no changes OR the user explicitly opted out. "I'll commit manually later" is not a valid skip reason — on 2026-04-11 "later" became "lost work from a bad merge". Git is the recovery mechanism.
- **Phase 13 stages files explicitly.** Never `git add -A` / `git add .` — always `git add <path>` per file to avoid sweeping up secrets or drift from other sessions.
- **Phase 13 never bypasses hooks.** No `--no-verify`, no `--no-gpg-sign`. If a pre-commit hook fails, fix the underlying issue and create a new commit.
- **Phase 2a cache cleanup is mandatory.** The `.research-cache/<id>.*` files are per-run scratch; delete them as soon as the cleaned text is in working memory (see Phase 2a). Do NOT defer to end-of-run — a mid-run failure leaves them behind. Scope the `rm` strictly to this run's id; never sweep the whole directory blindly (collides with parallel runs). Phase 11 must report `Cache: cleaned` (or the residue path) so the user has a verification signal. The 2026-05-01 maintenance commit hardening this rule was prompted by ~20 stray cache files accumulating across prior runs that all silently skipped this step.

---

## Skill Iteration Log

Moved to **[`ITERATION-LOG.md`](./ITERATION-LOG.md)** (sibling file, same directory).
It records *why* each non-obvious rule exists — read it before deleting a rule that
looks redundant, and append to it when Phase 10 produces a new one. It is not loaded
with this file; open it on demand.
---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
