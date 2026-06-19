# Marcus Lee — Software Developer — L1 report

_Level-1 theoretical, code-grounded walkthrough. No live app. Read-only over `C:\Users\mkdol\dolla\personas\.claude\worktrees\uat-adopt`. Surface model built from source; every claim cites file:line. L2-confirm tags mark what must be verified live._

Character: `software-developer` (Marcus Lee), Builder tier, dev build → reaches dev-only surfaces.

## Per-journey verdicts

- **build-persona-from-intent → L1-pass.** Intent → multi-turn build session (real Claude CLI piped a 729-line connector-aware prompt) → gated questions → draft → test → finalize, no dead-ends. The prompt is real, inspectable machinery, not magic.
- **wire-credential-connector → L1-conditional.** Every type-picker path reaches a saved, AES-256-GCM-encrypted credential and the runtime injects it as a real `$ENV` var the agent uses against the live API. Major: the "stays local / never leaves your machine" trust claim is NOT surfaced at the moment a secret is typed — only a terse "Encrypted at rest" lock badge, and only on schema forms.
- **run-and-review-execution → L1-pass.** Execute → phase/tool-call timeline + raw output → history → manual review; accept/reject writes a "Learned" memory AND resumes the blocked work. The loop genuinely closes — this is the orchestration Marcus wouldn't trivially script.
- **synthesize-team → L1-pass.** `synthesize_team_from_templates` + `TeamCanvas` + `TeamSynthesisPanel` exist; roles + git-discipline handoff contract are explicit and legible in the team prompt. Reachable at Builder tier.

## Findings

### [major][trust] trust — "credentials stay local" not surfaced at secret entry
- expected: At the moment a skeptical dev pastes a PAT/token, the UI states the credentials-stay-local / AES-256-GCM / no-cloud-custody promise (the README's headline trust claim).
- got: The type picker is a bare tile grid with zero trust copy (`CredentialTypePicker.tsx:85-176`). The only signal is a green-lock badge reading "Encrypted with OS Keychain" / "Encrypted at rest" rendered next to the Save button — and only when a `password`-type field is present (`FormActions.tsx:34-43`). The en.json strings are encryption-only, not locality: `encrypted_keychain: "Encrypted with OS Keychain"`, `encrypted_at_rest: "Encrypted at rest"`. AI-built-connector / OAuth / autopilot flows don't render FormActions at all, so those paths show no trust signal.
- evidence: `src/features/vault/sub_catalog/components/forms/CredentialTypePicker.tsx:85`; `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34-43`; `src/i18n/locales/en.json` (vault.credential_forms.encrypted_keychain / encrypted_at_rest)
- code_check: present-but-missed (the claim is true in code — `crypto.rs:6-8` uses `Aes256Gcm` + `OsRng` nonce + `zeroize` — but the *locality/no-cloud* promise is never told to the user where it matters).
- reachable: yes (Keys → Add New).
- l2_priority: confirm whether any banner/tooltip elsewhere in the add-flow states locality before save; judge whether a buyer-grade dev would trust it. Marcus reads encryption ≠ "doesn't leave my box."

### [minor][missing] missing-feature — no explicit "pin THIS repo" control on a solo code persona's Connectors tab
- expected: For "wire a code-review agent into my real repo," Marcus expects a first-class affordance to bind a local checkout / repo to the persona and confirm it's the grounding source.
- got: The strongest repo grounding — `CODEBASE_ROOT_PATH` set from a `dev_projects.root_path` on disk + a repo-scoped codebase MCP sidecar — is wired via `design_context.devProjectId`, which is written by the **team adoption** path (`template_adopt.rs`), not by any per-persona control in `sub_connectors`. `grep devProjectId src/features/**` returns zero UI writers. A solo persona falls back to the sidecar's "global first-project default" probe (`cli_mcp_config.rs:140-152`) — so it still gets real codebase context IF the user registered a project in Dev Tools, but there's no obvious "this persona reads repo X" UI.
- evidence: `src-tauri/src/engine/runner/mod.rs:1100-1164` (pin → CODEBASE_* env, worktree redirect); `src-tauri/src/engine/cli_mcp_config.rs:140-152` (unpinned → global probe); `src-tauri/src/commands/design/template_adopt.rs` (devProjectId writer); connectors tab has only credential-demand UI (`src/features/agents/sub_connectors/components/connectors/AgentCredentialDemands.tsx`).
- code_check: present-but-missed (grounding exists and is excellent; the *solo* binding UX is implicit via global probe / Dev Tools, not explicit).
- reachable: yes (Dev Tools projects + Connectors tab), but discoverability is the gap.
- l2_priority: live-confirm a solo code-review persona actually resolves the user's registered repo via the global probe and that `git`/codebase MCP tools see real files (not a clone-on-demand from a PAT alone).

### [minor][clarity] confusion — credential form action labels are hardcoded English
- expected: All chrome localized (14-language product).
- got: "Cancel", "Save Credential", "Saving..." are literal strings in JSX, not `t.*`.
- evidence: `src/features/vault/sub_credentials/components/forms/FormActions.tsx:49,65`
- code_check: present-broken (i18n bypass).
- reachable: yes. l2_priority: none (cosmetic for Marcus; flagged for i18n backlog, do-not-bulk-migrate per CLAUDE.md).

### [minor][senior-quality] quality-gap — autonomous fallback prompt instructs agents to fabricate sample data on connector failure
- expected: A code persona that can't reach the repo/Sentry should report the blocker, not invent output.
- got: Build prompt Rule 7 mandates the generated `system_prompt` include: "If any required service … is not accessible or returns auth errors, you MUST generate realistic sample data and continue the FULL workflow … NEVER stop or report 'blocked'." For Marcus's senior bar (no hallucinated APIs, real risk named) this is the exact failure mode he fears — a code-review agent confidently producing fake findings when the connector is down. Mitigations exist (DELIBERATE mode raises `manual_review`/`raise_incident` instead, `prompt/mod.rs:212-233`; `business_outcome: precondition_failed`, `templates.rs:289`), but DELIBERATE is opt-in via the `execution_discipline` param and AUTONOMOUS is the default.
- evidence: `src-tauri/src/engine/build_session/session_prompt.rs:389` (Rule 7 fabrication directive); `src-tauri/src/engine/prompt/mod.rs:160-165,829-836` (AUTONOMOUS is default discipline).
- code_check: present-but-missed (by-design for business demo personas; a foot-gun for code personas unless DELIBERATE is set).
- reachable: yes. l2_priority: HIGH — run a code persona with a broken connector and verify whether it fabricates or honestly reports. This is the single sharpest risk to Marcus's adoption.

## What passed (strengths to protect)

- **The prompt is fully readable and the machinery is exposed — this is what wins Marcus.** Runtime prompt assembly is plain, inspectable Rust: identity/instructions/toolGuidance/examples/errorHandling sections, a `## Available Credentials` block that literally lists the `$ENV` vars injected, and a `## Connector Usage Reference` (the test even uses a GitHub PAT/`api.github.com` example). `src-tauri/src/engine/prompt/mod.rs:120-851`, `:512-583`, `:1344-1380`.
- **Real credentials, real APIs.** Credentials are AES-256-GCM-decrypted and pushed as `{CONNECTOR}_{FIELD}` env vars into the spawned Claude CLI, with per-credential OAuth auto-refresh and a denylist guarding the CLI's own subscription auth. `src-tauri/src/engine/runner/credentials.rs:46-174,446-825`; `src-tauri/src/engine/crypto.rs:6-8`.
- **Genuine repo grounding for code work.** A code persona pins a `dev_project` → `CODEBASE_ROOT_PATH` points at the real on-disk repo (or an isolated git worktree), and the codebase MCP sidecar resolves THIS repo. `runner/mod.rs:1100-1164`, `cli_mcp_config.rs:140-152`.
- **Code-aware discipline + TDD.** DELIBERATE mode (think-before-coding, stay-surgical, verify-before-emitting) and a TDD directive auto-appended for git/GitHub/Jira intents. `prompt/mod.rs:212-233`; `session_prompt.rs:393` (Rule 11).
- **The review loop actually closes.** `update_manual_review_status` → writes a `LearnedMemoryRef` (surfaced as a "Learned: …" toast) → publishes `review_decision.{status}` → `react_to_review_decision` resumes the blocked team assignment on approval. `src-tauri/src/commands/design/reviews.rs:1074-1136,1141-1224`.
- **Build session is robust, not a toy.** MAX_TURNS bound, per-event SQLite checkpoints, a Rust-side capability-gate state machine that suppresses out-of-order LLM resolutions and synthesizes batched clarifying questions, RAII temp-dir cleanup, cancel-mid-turn. `src-tauri/src/engine/build_session/runner.rs:144-1554`.
- **Team prompt encodes real engineering policy** (origin-is-truth, worktree isolation, PR+QA merge gate, no force-push, lock-file CI integrity). `src-tauri/src/engine/runner/team_context.rs:300`.
- **Execution transparency.** Phase timeline with per-tool-call dots + durations gives Marcus the "what did it actually do" view. `src/features/agents/sub_executions/components/runner/RunnerStreamView.tsx:48-107`.

## Character voice

Alright, I came in ready to sneer at "no-code AI" and I didn't get to. I opened the hood expecting a wrapper hiding a hidden prompt, and instead I found `prompt/mod.rs` handing me the literal system prompt section-by-section, a `## Available Credentials` block that names the exact `$GITHUB_TOKEN`-shaped env vars it injects, and a runtime that AES-256-GCM-decrypts my secret and shells the real Claude CLI with `git` and `curl` against my real repo. The build session isn't a fill-in-the-blanks form — it pipes a 700-line capability prompt into the CLI over a multi-turn gate machine and checkpoints every event. That's not a worse cron. That's the orchestration + monitoring + review-loop I'd have spent a weekend half-building and never finished. The review loop especially: accept → it writes a memory → it resumes the blocked step. I'd keep that.

Three things stop me short of "ship it to my team." One: when I paste a PAT, nothing tells me the secret stays on my box — I get a "Encrypted at rest" badge if I'm lucky and on the right form. I *know* it's local because I read crypto.rs; a teammate who didn't will assume cloud and bail. Say it where I type the secret. Two: the default execution mode tells the generated agent to fabricate "realistic sample data and continue" when a connector 401s. For a code-review or Sentry-triage agent that's the cardinal sin — confidently wrong about code is exactly my pet peeve. The DELIBERATE mode that fixes this is opt-in and buried in a param; it should be the default for anything that touches git/Sentry. Three: the killer feature — pinning my actual repo on disk so the agent reads real files — is wired through *team adoption*, not a button on my solo persona's Connectors tab. It falls back to a global probe, so it probably works, but I shouldn't have to grep the Rust to learn that.

Would I adopt it? Yes — for the orchestration and the honest internals, with DELIBERATE flipped on and after I L2-confirm it reports blockers instead of inventing them. Would I tell a peer? "It's the rare AI-agent tool that respects you enough to show the prompt and run the real CLI against your real repo — just turn off the demo-mode fabrication before you point it at production code."
