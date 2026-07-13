# onboarding-bench — lessons learned

Hard-won facts from building and running the build-bench / clarify-bench harnesses
against the live app, plus a source-verified map of the creation UI. **Read this
before writing or running a nightly batch** — most of these cost a wasted run to
discover.

---

## A. How the build actually behaves (measured, not assumed)

1. **`draft_ready` is the interactive terminal.** An interactive build resolves the
   persona and then *waits for the user* to test/promote in the UI. Only `one_shot`
   auto-promotes. A harness that polls for `promoted` will sit until timeout and
   report a false **HUNG**. This single bug made a converged 2-capability build look
   like a hang. Treat `draft_ready` as success; promote explicitly afterwards.

2. **`one_shot` mode structurally suppresses every clarifying question.** The runner
   bypasses the gate machine and injects *"you are in autonomous one-shot mode — do
   NOT ask the user anything"*. **You cannot test question quality in one_shot.**
   Onboarding testing must use `mode: "interactive"`.

3. **The build genuinely ASKS — it does not assume.** This is the anti-legacy win and
   it holds: on `"make me a bot that helps with my emails"` it asked mission → memory
   → **human-review** → connector → trigger, and correctly surfaced the auto-send
   safety gate ("always review, nothing auto-sends").

4. **But it over-corrects, in two measurable ways:**
   - **Over-asks on clear input.** A *fully specified* intent ("Every day at 9am,
     fetch the top 5 HN stories, show them in the titlebar, no publishing") — which
     `session_prompt` Rule 26 says should draw **zero** questions — drew **4
     gratuitous** ones (output format, memory, review, storage).
   - **Asks serially.** 3–5 questions, **one per round**, ignoring Rule 25's ≤2-round
     cap. Each round is a full CLI turn, so vague input becomes very slow
     (400–900 s). Measured across 5 fixtures, every single one asked serially.

   Root cause: the round-cap and fast-path are *prompt* rules the model treats as
   advisory, while the Rust `gates.rs` machine defaults review/memory/output to
   "always ask". **Over-asking is a first-class failure**, not a safe default — it is
   as damaging to onboarding as assuming.

5. **It still assumes the connector.** In the email run it bound `gmail_search`
   without ever asking the provider. Right by luck, wrong by process. This is exactly
   why the connector-choice axis uses a **non-default pick with a decoy**.

6. **Promote can be blocked by an environmental connector health-check.** Airtable's
   generic healthcheck returns HTTP 422 (`INVALID_REQUEST_UNKNOWN` — it needs a
   `base_id`), which fails the build-readiness outcome gate. The persona is still
   fully composed. **Judge the design from `agent_ir` / `design_context`, not from
   whether promote succeeded.** Don't let a connector's healthcheck quirk read as a
   build-quality failure.

7. **Fan-out scope-creep.** When the (parallel) engine resolves each capability in
   isolation, sub-agents re-implement each other's jobs and invent connectors — one
   run added a `gmail` connector nothing asked for. Hence the `max_capabilities`
   scope-creep gate on every scenario.

---

## B. Driving the real creation UI (source-verified)

8. **Two different question renderers exist. This is the biggest trap.**
   - Template **adoption** renders `GlyphQuestionCard` — it *has* testids
     (`glyph-question-<cellKey>`, `glyph-option-<i>`, `glyph-submit-button`).
   - The **from-scratch build** (what onboarding uses) renders `GlyphAnswerCard` —
     its root and option buttons have **no data-testid at all**.

   So **do not build around `glyph-question-*`**. Submit answers through the bridge
   (`listPendingBuildQuestions` → `answerPendingBuildQuestions`).

9. **The connector picker is the one thing you *can* assert in the DOM.** Both
   renderers route a `connectorCategory` question to `VaultConnectorPicker`, whose
   container carries `vault-connector-picker-<category>` (or
   `vault-connector-picker-empty`). That testid is our proof the user *could* choose.
   The individual connector cards have **no testid** — they're `<button role="radio">`
   with the credential name as text — and **selecting one emits its `service_type`**.

10. **Test / Promote / Refine buttons have no testid.** Use the bridge
    (`triggerBuildTest`, `promoteBuildDraft`) or `/build/test`, `/promote-build`.

11. **`/eval` is fire-and-forget.** It returns `{"success":true}` — *not* the JS
    result. Read state back via `/bridge-exec` or `/query`. A backgrounded/occluded
    WebView2 silently drops eval'd JS (the server auto-`/focus`es and retries 3×), so
    keep the window foregrounded during a nightly run.

12. **`/find-text` is case-asymmetric** — it matches `textContent` (pre-CSS) but
    returns `innerText` (post-CSS, often uppercased). Prefer testids.

13. **`bridge.ts` is NOT hot-reloadable.** Adding a bridge method requires a full
    `tauri:dev:test` restart. Design the method set up front. *This framework
    deliberately uses only methods that already exist*, so it needs no app rebuild.

14. **The published testid inventory is partly stale.** `create-agent-btn`,
    `agent-name-input`, `agent-test-btn`, `agent-cancel-btn` are documented but do
    **not** exist in `src/`. Verify against source before depending on a testid.

15. **HTTP body fields are snake_case (`test_id`, `cell_key`); `/bridge-exec`
    `params` are camelCase (`personaId`, `answers`)** and are matched *by declared
    parameter name*, so always pass an object, never positional args.

---

## C. Environment & isolation

16. **Never edit `src-tauri/**` while a run is in flight.** Any Rust edit triggers a
    recompile and restarts the app, killing the run. Nightly batches must be the only
    thing touching the app — hence the `--no-idle-check` guard being *off* by default.

17. **The dev app can wedge.** `npm run tauri:dev:test` launched from a
    non-interactive shell exits **127** while its children detach; when the
    orchestrator later dies, nothing resupervises it — Vite (`:1420`) disappears and
    the bridge starts returning **504**. Preflight must check **both** the bridge and
    Vite, and fail fast rather than produce garbage results.

18. **`/test/reset` does not wipe the database.** It resets bridge/build-session
    state only. Delete created personas explicitly (`deletePersona`). Every persona
    this framework creates is name-tagged `OB-` so a stale batch can be swept by
    prefix.

19. **A fresh isolated instance has an EMPTY vault.** `PERSONAS_DATA_DIR` +
    `PERSONAS_TEST_PORT` + `PERSONAS_VITE_PORT` (see `scripts/test/launch-isolated.mjs`)
    give a clean DB — but then *every* connector-choice scenario has nothing to pick,
    and `vault-connector-picker-empty` renders. Two consequences:
    - Connector picks are **resolved at runtime against the live vault**, never
      hardcoded (`{{CONNECTOR}}` / `{{DECOY}}` placeholders).
    - A scenario whose category has no credential is marked **`degraded`**: the
      *ask* gates still apply, the *choose* gates are **skipped, not failed**.
    Caveat: WebView2 `localStorage` (onboarding flag, tour progress) does **not**
    relocate with `PERSONAS_DATA_DIR`.

20. **Windows stdout is cp1250 and will crash on `→ · ✓`.** Reconfigure
    `sys.stdout`/`sys.stderr` to UTF-8 in every script. (It bit us again while
    printing generated scenarios.) Likewise `subprocess.run(..., text=True)`
    mojibakes UTF-8 — pass `encoding="utf-8"`.

21. **The `claude` CLI user-simulator must run under subscription auth.** Strip
    `ANTHROPIC_API_KEY` (else it bills the API and can fail on credit balance) and
    strip `CLAUDECODE` / `CLAUDE_CODE_*` (an inherited nesting env makes the child a
    silent sub-session with no transcript).

22. **A concurrent CLI session may auto-commit your working tree.** Stage explicitly
    and commit in one invocation (`git reset -q && git add <paths> && git commit`);
    never `git stash` work that isn't yours.

---

## D. Test-design lessons

23. **An LLM-simulated user beats a canned answer map.** Canned answers only cover the
    questions you *predicted*; they cannot answer what the build actually asks, and
    they can't prove convergence to a hidden intent. The simulator holds the true
    intent and reveals only what each question asks.

24. **Ground scenarios in real catalog data.** The 299 shipped recipes, 124 templates
    and 133 connectors give concrete jobs, realistic service chains, and a *free
    ask/don't-ask oracle*: a template's `service_flow` is either category-valued
    (`email`, `messaging`, `CRM` → the build **must** ask which connector) or
    concrete-valued (`GitHub`, `Linear`, `Stripe` → it must **not** ask).

25. **Always carry a negative control.** `ctl-hn-digest-zero-ask` (fully specified,
    expect ~0 questions) is the regression gate for over-asking, and
    `ctl-named-connector-no-ask` for gratuitous connector questions. Without them a
    suite rewards interrogation.

26. **Use a decoy, not just a target.** Asserting "bound Outlook" is weak; asserting
    "bound Outlook **and not** Gmail" catches the silent-popular-default bug that a
    real baseline actually exhibited.

27. **Weak oracles must be soft.** Trigger type inferred from a recipe's *category* is
    a guess (a "Support Digest" filed under `development` is really a schedule), so
    it is a judge signal, not a hard gate. Only hand-written controls assert triggers
    hard. Prefer a skipped/soft gate over a false failure.

---

## E. Status of this framework

- Scenario generation, the deterministic gate layer, and the judge-bundle emitter are
  **implemented and validated offline** (including negative tests: the assumption trap
  scores 3/8 and the over-ask control 1/6 — the gates do catch the real failures).
- **The UI runner has NOT yet been executed against a live app** — it was authored
  against a source-verified bridge contract while another session owned the running
  instance. **The first nightly session must run the smoke checklist in
  [README.md](./README.md#first-run-smoke-checklist) on a single control scenario
  before launching a batch.**
