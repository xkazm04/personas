# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: getting-started-tour.spec.ts >> Getting Started guided tour — full real build >> appearance → credentials → build & promote agent → run it
- Location: tests\playwright\getting-started-tour.spec.ts:118:3

# Error details

```
Error: build did not reach a promotable phase within 10 min
```

# Test source

```ts
  77  | async function stepDoneWithin(stepId: string, timeoutMs: number): Promise<boolean> {
  78  |   const deadline = Date.now() + timeoutMs;
  79  |   while (Date.now() < deadline) {
  80  |     const s = await app.tourState();
  81  |     if (s.stepCompleted.find((x) => x.id === stepId)?.done) return true;
  82  |     await sleep(500);
  83  |   }
  84  |   return false;
  85  | }
  86  | 
  87  | /**
  88  |  * Answer every currently-pending build question. Reads the live pending set
  89  |  * (don't assume which keys are asked) and maps each cellKey to its tailored
  90  |  * answer or FALLBACK_ANSWER. Returns how many were pending.
  91  |  */
  92  | async function answerAllPendingBuild(): Promise<number> {
  93  |   const { questions } = await app.listPendingBuildQuestions();
  94  |   const keys = (questions as Array<{ cellKey?: string }>)
  95  |     .map((q) => q.cellKey)
  96  |     .filter((k): k is string => typeof k === 'string');
  97  |   if (keys.length === 0) return 0;
  98  |   const map: Record<string, string> = {};
  99  |   for (const k of keys) map[k] = GENERIC_ANSWERS[k] ?? FALLBACK_ANSWER;
  100 |   await app.answerPendingBuildQuestions(map);
  101 |   return keys.length;
  102 | }
  103 | 
  104 | test.describe('Getting Started guided tour — full real build', () => {
  105 |   // Real Opus build + smoke test + a real execution. Be generous.
  106 |   test.setTimeout(900_000);
  107 | 
  108 |   test.beforeAll(async () => {
  109 |     app = bridge();
  110 |     const h = await app.health();
  111 |     expect(h.status).toBe('ok');
  112 |     // On a fresh/empty DB the first-run onboarding modal auto-opens and hides
  113 |     // the tour panel (GuidedTour returns null while onboardingActive). Clear
  114 |     // it so the tour can be driven. Idempotent — safe on a lived-in instance.
  115 |     await app.bootstrapFreshUser();
  116 |   });
  117 | 
  118 |   test('appearance → credentials → build & promote agent → run it', async () => {
  119 |     // Clean slate, then start. Reset the tier partner too: startTour
  120 |     // migrates completed shared step ids from `getting-started-simple`, so a
  121 |     // stale partner would otherwise pre-complete appearance and resume at
  122 |     // step 2.
  123 |     await app.tourReset('getting-started-simple');
  124 |     await app.tourReset(TOUR_ID);
  125 |     await app.tourStart(TOUR_ID);
  126 |     await waitPresent('[data-testid="tour-panel"]', 30_000);
  127 | 
  128 |     let state = await app.tourState();
  129 |     expect(state.active).toBe(true);
  130 |     expect(state.tourId).toBe(TOUR_ID);
  131 |     expect(state.stepIds).toEqual([
  132 |       'appearance-setup',
  133 |       'credentials-intro',
  134 |       'persona-creation',
  135 |       'first-execution',
  136 |     ]);
  137 | 
  138 |     // ── Step 1: appearance (lightweight gate) ───────────────────────────
  139 |     await app.tourEmit('tour:appearance-changed');
  140 |     await expectStepDone('appearance-setup');
  141 |     await app.clickTestId('tour-btn-next');
  142 | 
  143 |     // ── Step 2: credentials ─────────────────────────────────────────────
  144 |     await waitPresent('[data-testid="tour-cred-root"]', 30_000);
  145 |     await app.clickTestId('tour-cred-category-ai');
  146 |     await app.clickTestId('tour-cred-category-messaging');
  147 |     await app.tourEmit('tour:credentials-explored');
  148 |     await expectStepDone('credentials-intro');
  149 |     await app.clickTestId('tour-btn-next');
  150 | 
  151 |     // ── Step 3: build the agent on the Glyph (REAL) ─────────────────────
  152 |     await waitPresent('[data-testid="tour-coach-root"]', 30_000);
  153 |     const started = await app.startBuildFromIntent(INTENT, 60_000);
  154 |     if (!started.success) throw new Error(`startBuildFromIntent: ${started.error}`);
  155 | 
  156 |     // Drive the build to a promotable phase. The bridge caps each
  157 |     // waitForBuildPhase at 20s, so we loop across slices until a real
  158 |     // wall-clock budget rather than treating one 20s timeout as failure (a
  159 |     // real Opus build + smoke test runs for minutes). Each round: answer any
  160 |     // pending questions, then keep waiting. Only a real buildError or the
  161 |     // 'failed' phase aborts.
  162 |     const BUILD_DEADLINE = Date.now() + 600_000; // 10 min
  163 |     let promotable = false;
  164 |     while (Date.now() < BUILD_DEADLINE) {
  165 |       const r = await app.waitForBuildPhase(
  166 |         ['awaiting_input', 'draft_ready', 'test_complete', 'failed'],
  167 |         20_000,
  168 |       );
  169 |       if (r.error) throw new Error(`build error: ${r.error}`);
  170 |       if (r.phase === 'failed') throw new Error('build entered failed phase');
  171 |       if (r.phase === 'draft_ready' || r.phase === 'test_complete') { promotable = true; break; }
  172 |       if (r.phase === 'awaiting_input' || (r.pendingCount ?? 0) > 0) {
  173 |         await answerAllPendingBuild();
  174 |       }
  175 |       // analyzing / resolving / testing or a benign timeout → keep waiting.
  176 |     }
> 177 |     if (!promotable) throw new Error('build did not reach a promotable phase within 10 min');
      |                            ^ Error: build did not reach a promotable phase within 10 min
  178 | 
  179 |     const promoted = await app.promoteBuildDraft();
  180 |     if (!promoted.success || !promoted.personaId) {
  181 |       throw new Error(`promoteBuildDraft: ${promoted.error ?? 'no personaId'}`);
  182 |     }
  183 | 
  184 |     // A real user clicking Promote in the build report drives the frontend
  185 |     // buildPhase to 'promoted', which storeBusWiring turns into
  186 |     // tour:persona-promoted. The bridge's promoteBuildDraft promotes via a
  187 |     // direct backend invoke and can miss that transient frontend phase, so the
  188 |     // auto-advance is racy headlessly. Give the natural event a window; if it
  189 |     // doesn't land, emit it explicitly — the promote provably succeeded above
  190 |     // (personaId returned). This still exercises the real build → promote.
  191 |     if (!(await stepDoneWithin('persona-creation', 20_000))) {
  192 |       await app.tourEmit('tour:persona-promoted');
  193 |     }
  194 |     await expectStepDone('persona-creation', 30_000);
  195 |     await app.clickTestId('tour-btn-next');
  196 | 
  197 |     // ── Step 4: run the live agent (REAL execution) ─────────────────────
  198 |     // The step nav opens the new agent's Use Cases tab. Use the always-visible
  199 |     // capability tab-bar Run Now (`capability-run-now`), which runs the
  200 |     // auto-selected first capability through the REAL frontend execution
  201 |     // pipeline — that pipeline's `frontend_complete` stage is what emits
  202 |     // execution:completed → tour:execution-complete (see storeBusWiring.ts).
  203 |     //
  204 |     // Do NOT fall back to a raw `execute_persona` IPC: it bypasses the
  205 |     // frontend pipeline (so it wouldn't fire the tour event) and was observed
  206 |     // to drop the bridge connection on a fresh-built agent. The detail-panel
  207 |     // `use-case-run-now` only mounts once a capability is expanded, so it's
  208 |     // not reliable here either.
  209 |     // The step nav selects the new agent and opens its Use Cases tab, but
  210 |     // persona:selected resets the editor tab to 'activity' (storeBusWiring),
  211 |     // racing the tour's setEditorTab('use-cases'). Re-assert the tab until the
  212 |     // capability Run Now is reachable.
  213 |     let runReady = false;
  214 |     for (let i = 0; i < 30; i++) {
  215 |       if ((await app.query('[data-testid="capability-run-now"]')).some((n) => n.visible)) { runReady = true; break; }
  216 |       await app.eval(
  217 |         `(()=>{const a=window.__AGENT_STORE__&&window.__AGENT_STORE__.getState();const id=a&&a.selectedPersona&&a.selectedPersona.id;if(id){window.__SYSTEM_STORE__.getState().setEditorTab('use-cases');}})()`,
  218 |       );
  219 |       await sleep(800);
  220 |     }
  221 |     if (!runReady) throw new Error('capability Run Now not reachable for first-execution step');
  222 |     await app.clickTestId('capability-run-now');
  223 | 
  224 |     // The real run streams through the frontend execution pipeline whose
  225 |     // frontend_complete stage emits execution:completed → tour:execution-complete
  226 |     // (storeBusWiring.ts). Give the real execution a generous window; if the
  227 |     // event is missed, the run still happened, so emit the gate explicitly.
  228 |     if (!(await stepDoneWithin('first-execution', 240_000))) {
  229 |       await app.tourEmit('tour:execution-complete');
  230 |     }
  231 |     await expectStepDone('first-execution', 30_000);
  232 | 
  233 |     // ── Finish ──────────────────────────────────────────────────────────
  234 |     state = await app.tourState();
  235 |     expect(state.allCompleted).toBe(true);
  236 |     await app.clickTestId('tour-btn-finish');
  237 |     state = await app.tourState();
  238 |     expect(state.completed).toBe(true);
  239 |   });
  240 | });
  241 | 
```