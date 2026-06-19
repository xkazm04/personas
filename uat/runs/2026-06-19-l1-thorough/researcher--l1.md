# Dr. Nadia Brooks — Researcher / Academic — L1 report

**Journey:** `companion-do-a-job` — "Ask the companion (Athena) to just do a research job."
**Character:** `researcher` (semi-technical, Team tier; rigor > speed; treats any uncited claim as guilty until verified).
**Level:** L1 (theoretical, code-grounded surface walk — no live app).
**Date:** 2026-06-19

---

## Journey verdict: `L1-conditional`

**Rationale.** Structurally, the research path is real and far better than I feared walking in: the companion turn is a Claude Code CLI spawn that genuinely has live `WebSearch` / `WebFetch` / `Agent` (subagent) tools, and the system prompt explicitly tells it to cite source URLs inline so I can verify. That clears my biggest fear — this is not a closed-box that recites training data unmarked. But the two things that make-or-break a brief for me — *enforced* citation of external web claims, and *injection of my own knowledge base* — are **not** there. Web-citation is a prompt instruction (LLM-compliance), not a code-enforced contract the way persona-memory provenance is; and the RAG lane that feeds the turn injects the app's own doctrine, not documents I upload. The job completes, but a senior would not circulate the output unverified — which is, to be fair, exactly the division of labor my own file specifies (app does first-pass gather, I keep verification). Conditional, not pass, because the uncertainty/citation rigor rides entirely on prompt adherence with no structural floor, and that is precisely the failure mode I have been burned by.

---

## Surface model walked (affordance → handler → command → engine/prompt)

The companion ("Athena") is reachable from the Team tier via the title-bar orb / CompanionPanel (chrome). A chat message becomes a turn:

- **Turn spawn:** `src-tauri/src/companion/session.rs:1146-1187` — a real `claude` CLI child: `-p -`, `--model claude-opus-4-8` (`COMPANION_TURN_MODEL`, `session.rs:1103`), `--system-prompt-file`, `--dangerously-skip-permissions` (`session.rs:1181`), `CLAUDE_CODE_FORK_SUBAGENT=1` (`session.rs:1230`). Auth forced to subscription, not API key (`session.rs:1234`).
- **Tools available:** `session.rs:1164-1187` passes **no `--allowedTools` allowlist**, and `--dangerously-skip-permissions` removes the gate → the full default Claude Code toolbox (WebSearch, WebFetch, Agent/Task) is live for every regular turn. Browser-test turns additionally get Playwright MCP (`session.rs:1189-1209`), but that's a separate, approval-gated arc, not the research path.
- **Tool doctrine in prompt:** `src-tauri/src/companion/prompt.rs:1201-1235` (`tools_addendum`, always on) — tells Athena she has `WebSearch` ("search the live web… don't guess from training data when a search would settle it") and `WebFetch`, and **"cite the source URL inline so the user can verify ('According to … at <url>, …')"** (`prompt.rs:1228-1230`).
- **Research subagent:** `prompt.rs:1173-1174` registers `athena-web-researcher` — "WebSearch + WebFetch heavy… Returns a synthesis." The agent definition (system reminder) confirms it "Returns a synthesis with source URLs."
- **Grounding into the turn (RAG):** `src-tauri/src/companion/brain/retrieval.rs:1-244` — hybrid vector recall injects episodes, facts, goals, procedurals, and **doctrine** chunks. Doctrine = the app's own curated docs (`retrieval.rs:341-378`, `load_doctrine_chunks` reads `read_curated_doc`), NOT user-uploaded documents.
- **Connector tool surface:** `src-tauri/src/companion/connectors.rs:72-253` (`capabilities_for`) — sentry, github, gmail, slack, discord, notion, local_drive, elevenlabs, personas_database, operations_database. **No web-research / academic-source connector.**
- **Action dispatch:** `src-tauri/src/companion/dispatcher.rs:150-259` (`ALLOWED_ACTIONS`) — can build/run/assign/use-connector; no research-specific op (research happens *inside* the turn via WebSearch, before the reply, not as a dispatched op).

---

## Findings

### F1 — Web-claim citation is prompt-only, not code-enforced — `quality-gap`, **major**, reachable
- **file:line:** `src-tauri/src/companion/prompt.rs:1228-1230` (instruction) vs. `src-tauri/src/companion/dispatcher.rs:629-633` / `constitution.md:629-633` (the *enforced* contract, which is for persona-memory facts only).
- **What I see:** For facts Athena writes to her brain, the provenance contract is structurally enforced — the dispatcher *rejects* a `write_fact` / `write_procedural` op with an empty `sources` array at parse time ("a fact you can't cite is a hallucination", `constitution.md:629-633, 675-676`). That is exactly the rigor I want. But for the *web research claims that land in my chat answer*, the only thing requiring a citation is a prose instruction in `tools_addendum` (`prompt.rs:1228`). There is no code path that inspects the assistant text, detects an external factual claim, and refuses to render it without an accompanying URL. If the model paraphrases a web result and drops the link — or worse, answers from training data despite the "don't guess" instruction — nothing catches it.
- **Why it matters to me:** This is the precise gap that has burned me. Enforced provenance for the app's internal memory but instruction-only provenance for the external-world answer is backwards from a researcher's risk model: the external claim is the one going into my brief.
- **code_check:** `present-but-missed` — the citation directive is present; the *enforcement* is absent for web claims.
- **L2 priority:** `l2_priority` — a live run must confirm whether real WebSearch results actually carry openable URLs into the final bubble, and whether the model recites training-data facts unmarked when search would have been warranted.

### F2 — My uploaded knowledge base is not injected into the companion turn — `missing` / `grounding`, **major**, partially reachable
- **file:line:** `src-tauri/src/companion/brain/retrieval.rs:184-218` (doctrine lane reads app docs); `context-map.json:1328-1340` (knowledge-base context: "Local vector knowledge base… upload documents… The companion brain uses this for RAG-style context injection") — but the companion's retrieval lane pulls `kind = 'doctrine'` chunks (`retrieval.rs:353`), i.e. the *app's* curated docs, not arbitrary user-uploaded research documents.
- **What I see:** The journey's DoD says "It used my real context (my connectors, my data), not a canned answer." My connectors and my conversation history *are* injected. But the documents I'd upload to the knowledge base — the literature I'm synthesizing — do not appear to flow into the companion's prompt as retrievable source material; the doctrine lane is scoped to Personas' own docs. So "research my sources" means "search the live web," not "synthesize across the corpus I gave you." Also note the knowledge-base / embeddings path is `ml`-gated (`prompt.rs:14, 23-26, 36-37`; `desktop-full`), so on a standard Team build, vector recall itself may be degraded.
- **Why it matters to me:** My job-to-be-done is multi-source synthesis over *my* corpus. If I can only point Athena at the open web, that's a narrower tool than "synthesize the 15 PDFs in my folder."
- **code_check:** `confirmed-absent` for user-doc injection into the companion turn (doctrine lane is app-docs scoped); `l2_priority` to confirm whether `local_drive` connector reads can substitute (Athena could `use_connector local_drive read` files — `connectors.rs:163-182` — but that's per-file fetch, not corpus retrieval).

### F3 — Calibrated uncertainty is genuinely encouraged (strength) — **strength**, reachable
- **file:line:** `constitution.md:18-21` ("When you don't know, you say so… you don't puff up to seem confident"), `:43-45` ("You can be unsure. You can say 'I don't know'"), `:57-81` (provenance contract: cite, surface conflicts, "Never silently pick one"). Confidence is a first-class field on written facts (`constitution.md:639`, `dispatcher.rs` fact op carries `confidence: 0.0-1.0`).
- **What I see:** The character spec explicitly licenses hedging and "I don't have a memory of that yet" instead of confabulating. This is the opposite of the confident-summary-hiding-uncertainty failure mode in my pet peeves. It's prompt-level, but it's prominent and recency-weighted.
- **code_check:** `by-design` — uncertainty framing is structurally privileged in the constitution.

### F4 — Real research capability exists, not chat-only (strength) — **strength**, reachable
- **file:line:** `session.rs:1164-1187` (no tool allowlist + skip-permissions ⇒ WebSearch/WebFetch/Agent live), `prompt.rs:1148` ("You're researching with WebSearch and the picture isn't complete" → chain another turn), `prompt.rs:1173-1179` (parallel subagent dispatch incl. `athena-web-researcher`).
- **What I see:** The companion can actually *do* a research job — fan out web searches, fetch URLs, dispatch a research subagent — within a turn or across autonomous ticks, then synthesize. This is materially faster than my manual first pass (rubric dim 6), which is the whole reason I'd use it.
- **code_check:** `present` — capability is real, not a mock.

### F5 — No claim→source traceability artifact; provenance is inline prose only — `clarity`, **minor**, reachable
- **file:line:** `prompt.rs:1228-1230` (inline citation only); contrast `dispatcher.rs:1038-1126` (`show_browser_test_report` produces a *structured* artifact with per-step evidence). There is no analogous "research report" chat card that pins each claim to its source as structured data.
- **What I see:** Citations, when present, are woven into prose ("According to … at <url>"). For a brief I need to retrace, prose citations are losable — "the constitution even tells her to keep it 'natural, not forensic… one reference in passing'" (`constitution.md:70-71`), which is the *wrong* default for my use case. There's no source-list footer, no per-claim anchor.
- **code_check:** `confirmed-absent` — no structured research-report card; traceability depends on reading prose carefully.

---

## What passed

- **Completion (partial):** The job runs end-to-end — a real CLI turn with live web tools can gather + synthesize and reply. Passes structurally; verification of correctness is L2.
- **Time-saved (pass):** Fan-out WebSearch + parallel `athena-web-researcher` subagent (`prompt.rs:1156-1179`) is unambiguously faster than my manual first pass. Matches my motivation anchor.
- **Trust — uncertainty (pass):** `constitution.md:18-21, 43-45, 57-81` privileges "I don't know," confidence scoring, and conflict-surfacing over false confidence.
- **Grounding — capability is real (pass):** Not a canned/closed model; genuine live-web tools (`session.rs:1164-1187`).
- **Grounding — my data (partial):** Connectors + conversation history are injected (`retrieval.rs`); my *uploaded corpus* is not (F2).
- **Trust — citations openable (conditional):** The instruction to cite real URLs exists (`prompt.rs:1228-1230`), but enforcement is absent (F1); whether real runs produce openable links is `l2_priority`.

### Per-rubric-dimension scorecard
| # | Dimension | Score | Evidence |
|---|---|---|---|
| 1 | completion | partial | Real turn + live tools; correctness unverified (L2). |
| 2 | effort | pass | One chat message; tools run pre-reply in one bubble (`prompt.rs:1232-1233`). |
| 3 | clarity | partial | Recall strip shows what was consulted (`prompt.rs:51-69`), but no claim→source artifact (F5). |
| 4 | trust | partial | Uncertainty privileged (F3); web-citation unenforced (F1). |
| 5 | missing | partial | Uploaded-corpus RAG into the turn is absent (F2). |
| 6 | time-saved | pass | Web fan-out + research subagent beats manual first pass (F4). |
| 7 | senior-quality | partial | Capable model + good framing, but no structural citation floor → "verify before circulating." |

### My scored acceptance criteria
1. **[trust] real openable citations / no fabrication** — *partial.* Instructed (`prompt.rs:1228`), not enforced (F1). `l2_priority`.
2. **[senior-quality] accurate + flags uncertainty** — *partial→pass on framing.* Uncertainty strongly privileged (F3); accuracy is L2.
3. **[grounding] researches sources, not training-data recital** — *pass on capability* (F4), *partial on my-corpus* (F2).
4. **[time-saved] faster than manual first pass** — *pass* (F4).
5. **[clarity] trace which claim came from which source** — *fail-leaning.* Prose-only, "not forensic" by design (F5).

---

## Character voice

I came in braced for a confabulator. I did not get one — and I want to be precise about why, because the distinction is the whole job.

The good: this thing actually *searches*. It's a real Claude Opus turn with live WebSearch and WebFetch, no tool allowlist stripping them out (`session.rs:1164-1187`), and a research subagent that returns a synthesis with source URLs. The prompt tells it, in plain words, not to guess from training data when a search would settle it, and to cite the URL inline so I can verify (`prompt.rs:1216, 1228-1230`). And the constitution gives it permission to say "I don't know" instead of puffing up (`constitution.md:18-21`). That is the right posture. Most assistants fail my first sniff test here; this one passes it.

The catch — and it's the catch that decides whether I'd put its output in a brief — is *where the rigor is enforced versus merely requested*. For the facts it writes into its own memory, citation is **enforced in code**: an empty `sources` array gets rejected at parse time, "a fact you can't cite is a hallucination" (`constitution.md:629-633`). For the web claim that ends up in *my answer*, citation is a sentence of prompt text. That's backwards. The internal note has a structural floor; the external claim going into my deliverable rides on the model's good behavior. **Source?** is exactly the question with no code-level answer here. Worse, it's told to keep citations "natural, not forensic, one reference in passing" (`constitution.md:70-71`) — which is the opposite of what I need to retrace a claim three weeks later. And it can't synthesize the corpus I'd actually hand it; the retrieval lane feeds it the app's own docs, not my uploads (`retrieval.rs:341-378`).

So: I'd use it for the first pass it's clearly built for. I would not circulate a word of it until I'd opened every link myself — and I'd want a live run to prove those links are real and openable before I trust even that. **Verdict: a capable, honestly-framed research assistant whose citation discipline is asserted, not guaranteed; I keep the verification, exactly as my own job description says — but the app should make me trust the gathering, and right now it asks me to take the gathering on faith.**
