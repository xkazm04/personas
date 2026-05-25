# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: getting-started-tour.spec.ts >> Getting Started guided tour — full real build >> appearance → credentials → build & promote agent → run it
- Location: tests\playwright\getting-started-tour.spec.ts:79:3

# Error details

```
Error: waitForBuildPhase: undefined
```

# Test source

```ts
  23  | const TOUR_ID = 'getting-started';
  24  | const INTENT =
  25  |   'Summarize my unread GitHub notifications every morning and post a short digest to a channel.';
  26  | 
  27  | // Generic answers keyed by the build's question cellKeys — any subset that
  28  | // is actually asked gets matched; the rest are ignored.
  29  | const GENERIC_ANSWERS: Record<string, string> = {
  30  |   'use-cases': 'Summarize unread GitHub notifications into a short morning digest.',
  31  |   connectors: 'GitHub to read notifications; a messaging channel to post the digest.',
  32  |   triggers: 'Run on a daily schedule each morning.',
  33  |   'human-review': 'No human review — send automatically.',
  34  |   messages: 'Post a concise bulleted digest to the chosen channel.',
  35  |   events: 'No event subscriptions.',
  36  |   memory: 'No memory needed between runs.',
  37  |   'error-handling': 'On failure, retry once then notify me.',
  38  | };
  39  | 
  40  | let app: CompanionBridge;
  41  | 
  42  | const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  43  | 
  44  | /** Poll until a selector is present in the DOM (works for position:fixed). */
  45  | async function waitPresent(selector: string, timeoutMs = 15_000): Promise<void> {
  46  |   const deadline = Date.now() + timeoutMs;
  47  |   while (Date.now() < deadline) {
  48  |     const nodes = await app.query(selector);
  49  |     if (nodes.length > 0) return;
  50  |     await sleep(300);
  51  |   }
  52  |   throw new Error(`selector not present within ${timeoutMs}ms: ${selector}`);
  53  | }
  54  | 
  55  | /** Poll tourState until the named step reports done. */
  56  | async function expectStepDone(stepId: string, timeoutMs = 15_000): Promise<void> {
  57  |   const deadline = Date.now() + timeoutMs;
  58  |   while (Date.now() < deadline) {
  59  |     const s = await app.tourState();
  60  |     if (s.stepCompleted.find((x) => x.id === stepId)?.done) return;
  61  |     await sleep(500);
  62  |   }
  63  |   const s = await app.tourState();
  64  |   throw new Error(
  65  |     `step "${stepId}" not completed within ${timeoutMs}ms; progress=${JSON.stringify(s.stepCompleted)}`,
  66  |   );
  67  | }
  68  | 
  69  | test.describe('Getting Started guided tour — full real build', () => {
  70  |   // Real Opus build + smoke test + a real execution. Be generous.
  71  |   test.setTimeout(900_000);
  72  | 
  73  |   test.beforeAll(async () => {
  74  |     app = bridge();
  75  |     const h = await app.health();
  76  |     expect(h.status).toBe('ok');
  77  |   });
  78  | 
  79  |   test('appearance → credentials → build & promote agent → run it', async () => {
  80  |     // Clean slate, then start. Reset the tier partner too: startTour
  81  |     // migrates completed shared step ids from `getting-started-simple`, so a
  82  |     // stale partner would otherwise pre-complete appearance and resume at
  83  |     // step 2.
  84  |     await app.tourReset('getting-started-simple');
  85  |     await app.tourReset(TOUR_ID);
  86  |     await app.tourStart(TOUR_ID);
  87  |     await waitPresent('[data-testid="tour-panel"]', 30_000);
  88  | 
  89  |     let state = await app.tourState();
  90  |     expect(state.active).toBe(true);
  91  |     expect(state.tourId).toBe(TOUR_ID);
  92  |     expect(state.stepIds).toEqual([
  93  |       'appearance-setup',
  94  |       'credentials-intro',
  95  |       'persona-creation',
  96  |       'first-execution',
  97  |     ]);
  98  | 
  99  |     // ── Step 1: appearance (lightweight gate) ───────────────────────────
  100 |     await app.tourEmit('tour:appearance-changed');
  101 |     await expectStepDone('appearance-setup');
  102 |     await app.clickTestId('tour-btn-next');
  103 | 
  104 |     // ── Step 2: credentials ─────────────────────────────────────────────
  105 |     await waitPresent('[data-testid="tour-cred-root"]', 30_000);
  106 |     await app.clickTestId('tour-cred-category-ai');
  107 |     await app.clickTestId('tour-cred-category-messaging');
  108 |     await app.tourEmit('tour:credentials-explored');
  109 |     await expectStepDone('credentials-intro');
  110 |     await app.clickTestId('tour-btn-next');
  111 | 
  112 |     // ── Step 3: build the agent on the Glyph (REAL) ─────────────────────
  113 |     await waitPresent('[data-testid="tour-coach-root"]', 30_000);
  114 |     const started = await app.startBuildFromIntent(INTENT, 60_000);
  115 |     if (!started.success) throw new Error(`startBuildFromIntent: ${started.error}`);
  116 | 
  117 |     // Answer clarifying questions until the draft leaves the questioning phase.
  118 |     for (let round = 0; round < 12; round++) {
  119 |       const r = await app.waitForBuildPhase(
  120 |         ['awaiting_input', 'resolving', 'draft_ready', 'testing', 'test_complete', 'failed'],
  121 |         120_000,
  122 |       );
> 123 |       if (!r.success) throw new Error(`waitForBuildPhase: ${r.error}`);
      |                             ^ Error: waitForBuildPhase: undefined
  124 |       if (r.phase === 'failed') throw new Error('build entered failed phase');
  125 |       if (r.phase === 'draft_ready' || r.phase === 'testing' || r.phase === 'test_complete') break;
  126 |       await app.answerPendingBuildQuestions(GENERIC_ANSWERS);
  127 |     }
  128 | 
  129 |     // Smoke test auto-runs after draft_ready; promote once promotable.
  130 |     const ready = await app.waitForBuildPhase(['draft_ready', 'test_complete'], 240_000);
  131 |     if (!ready.success) throw new Error(`waitForBuildPhase(promotable): ${ready.error}`);
  132 |     const promoted = await app.promoteBuildDraft();
  133 |     if (!promoted.success || !promoted.personaId) {
  134 |       throw new Error(`promoteBuildDraft: ${promoted.error ?? 'no personaId'}`);
  135 |     }
  136 |     const personaId = promoted.personaId;
  137 | 
  138 |     // Promote fires tour:persona-promoted → step completes.
  139 |     await expectStepDone('persona-creation', 60_000);
  140 |     await app.clickTestId('tour-btn-next');
  141 | 
  142 |     // ── Step 4: run the live agent (REAL execution) ─────────────────────
  143 |     // The step nav opens the new agent's Use Cases tab.
  144 |     await waitPresent('[data-testid="design-subtab-use-cases"]', 30_000);
  145 |     // Prefer the in-UI Run Now button; fall back to a direct execute_persona
  146 |     // so the tour can complete deterministically either way.
  147 |     const runNow = await app.query('[data-testid="use-case-run-now"]');
  148 |     if (runNow.some((n) => n.visible)) {
  149 |       await app.clickTestId('use-case-run-now');
  150 |     } else {
  151 |       await app.invokeCommand('execute_persona', {
  152 |         personaId,
  153 |         idempotencyKey: crypto.randomUUID(),
  154 |       });
  155 |     }
  156 | 
  157 |     // execution:completed → tour:execution-complete → step completes.
  158 |     await expectStepDone('first-execution', 240_000);
  159 | 
  160 |     // ── Finish ──────────────────────────────────────────────────────────
  161 |     state = await app.tourState();
  162 |     expect(state.allCompleted).toBe(true);
  163 |     await app.clickTestId('tour-btn-finish');
  164 |     state = await app.tourState();
  165 |     expect(state.completed).toBe(true);
  166 |   });
  167 | });
  168 | 
```