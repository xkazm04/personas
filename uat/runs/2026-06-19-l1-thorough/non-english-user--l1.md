# Sofía Ramírez — Spanish-speaking User — L1 report

- **Character:** `non-english-user` (Sofía Ramírez — Spanish marketer, Mexico City; functional English, judged in `es` throughout; tier: starter).
- **Level:** L1 (theoretical, code-grounded surface model; no live app).
- **Lens:** i18n-focused — Spanish coverage of `es.json`, hardcoded-English in JSX, scary-moment localization. Translation lag = by-design fallback (minor) UNLESS it blocks a core flow or hits a scary moment (credentials / sending / errors).
- **Working root:** `C:\Users\mkdol\dolla\personas\.claude\worktrees\uat-adopt`

## Method / surface model

The i18n system is structurally sound: `t` is a `Proxy` (`src/i18n/useTranslation.ts`) that deep-merges each `es` section over its English counterpart, so any missing/untranslated key silently renders English rather than `undefined`. `es.json` is **present for all of Sofía's reachable top-level sections** (only `kpis` is absent, and that's out of reach). The question for an L1 i18n run is therefore NOT "is the section present" — it's **"is the section actually translated, or a verbatim English copy that the merge resolves to English anyway?"**

Quantitative coverage I computed by diffing leaf keys of `en.json` vs `es.json` (`src/i18n/locales/{en,es}.json`), classifying each leaf as translated / identical-to-English (untranslated) / missing:

| Section (Sofía-reachable) | en keys | translated | untranslated (identical) | missing | coverage |
|---|---|---|---|---|---|
| home | 144 | 141 | 3 | 0 | **98%** |
| director | 133 | 128 | 5 | 0 | **96%** |
| error_registry | 80 | 74 | 6 | 0 | **93%** |
| sidebar | 76 | 71 | 3 | 2 | 93% |
| common | 168 | 151 | 16 | 1 | 90% |
| onboarding | 168 | 141 | 27 | 0 | 84% |
| errors | 20 | 20 | 0 | 0 | 100% |
| design | 12 | 12 | 0 | 0 | 100% |
| templates | 1106 | 875 | 220 | 11 | 79% |
| vault | 1455 | 1144 | 306 | 5 | 79% |
| agents | 2514 | 1817 | 665 | 32 | 72% |
| settings | 661 | 448 | 194 | 19 | 68% |
| execution | 34 | 18 | 16 | 0 | 53% |
| status_tokens | 92 | 68 | 24 | 0 | 74% |
| **matrix_v3** | 83 | **0** | **83** | 0 | **0%** |
| **plugins.companion** | 761 | **129** | **557** | 75 | **17%** |
| **debt** | 539 | **0** | **539** | 0 | **0%** |
| models | 7 | 0 | 7 | 0 | 0% (brand/technical — n/a) |

Quality of what IS translated is genuinely native, not machine-stilted (e.g. `home.greeting_morning` → "Buenos días"; `onboarding.describe_intent` → "Describe lo que tu agente debe hacer. Sé específico sobre la tarea, fuentes de datos y salida deseada."). The senior-quality bar for translated strings passes. The damage is concentrated in three sections at ~0–17% (`matrix_v3`, `plugins.companion`, `debt`), all of which sit on Sofía's journeys.

Locale machinery for Sofía specifically (`src/stores/i18nStore.ts`): `es` is Latin-script so it needs no Google Font → `fontReady` stays true → no font-load flash. The switch persists via Zustand `persist` (`personas-i18n-storage`, partialize→language) and re-applies on rehydrate (`onRehydrateStorage`, line 81). The actual no-English-first-paint guarantee (`preloadPersistedLocaleBeforeMount` in `main.tsx`) is a runtime property → `l2_priority`.

---

## Journey verdicts

### first-run-onboarding — `L1-pass`
Surface model: Home welcome (`src/features/home/sub_welcome/`) at 98%, onboarding tour at 84%, both native-quality. The language control is reachable two ways before any build: onboarding `AppearanceStep` (`src/features/onboarding/components/AppearanceStep.tsx:60`) and the Home `LanguageSwitcher` (`src/features/home/sub_welcome/LanguageSwitcher.tsx`); both call `setLanguage` on `i18nStore`, both prefetch on hover/intent. `es` is in both lists. Sofía can land, set Spanish, and read a native-quality first run. Findings are minor/by-design lag (scan-error string, interface-mode heading) plus one structural surface-binding mismatch (no locale control in Settings → Appearance) that doesn't block first-run because the control exists elsewhere. The no-English-flash-on-first-paint claim is real-but-unverifiable at L1 → deferred to L2.

### build-persona-from-intent — `L1-conditional`
The path has no dead-ends and the *intent entry* is localized (`t.agents.glyph_intent_placeholder`, `t.agents.glyph_launch`; `GlyphPrototypeLayout.tsx:491,505`). But the two surfaces Sofía leans on to *understand and trust* the built persona are mixed-language: (1) the **capability / Behavior-Core editor** renders entirely English because `matrix_v3` is 0% translated (the code is correctly wired to `t.matrix_v3.*` — `BehaviorCoreEditor.tsx` — so it's a data gap, not a code gap), and (2) the **build activity strip + failure error** stream raw English from the Rust backend. She finishes the job, but the "I understand what it will do before I let it loose" DoD lands in English at the exact moment it matters, and a build failure shows an English error. Completes → conditional, with one major.

### companion-do-a-job — `L1-conditional`
The companion tool surface is real (it can enqueue `connector_use` jobs — `ConnectorCallCard` / `companion.ts`), so the structural affordance exists. But `plugins.companion` is only 17% translated, and critically the **connector-call status line** a user watches while Athena "does the job" (`queued` / `running…` / `done` / `failed`, plus the in-flight hint "Athena will summarize the result when this finishes.") is untranslated English (`ConnectorCallCard.tsx:71-80,191`). The *retry* sub-flow is translated ("Reintentar", "Reintentando…") — so the screen is literally half-Spanish/half-English at the send/tool-call scary moment. Job completes; trust at the scary moment is damaged. Conditional.

---

## Findings

### [major][trust] quality-gap — Companion connector-call status is English at the tool-call/send scary moment
- **expected:** When Sofía asks Athena to do a job and watches it call a connector / send, the live status reads in Spanish.
- **got:** The primary status line is English: `queued`, `running…`, `done`, `failed`, and the in-flight hint "Athena will summarize the result when this finishes." The retry row beneath it IS Spanish — so one card shows both languages at once. `plugins.companion` overall is 17% translated.
- **evidence:** `src/features/plugins/companion/ConnectorCallCard.tsx:71-80` (status labels), `:191` (in-flight hint); coverage from `src/i18n/locales/es.json` `plugins.companion` (557 untranslated + 75 missing of 761).
- **code_check:** `confirmed-absent` — keys `connector_call_queued/running/completed/failed/in_flight_hint` exist in `en.json` and are copied verbatim into `es.json` (resolve to English via fallback); component is correctly wired to `t.plugins.companion.*`, so it's a translation-data gap.
- **reachable:** yes — companion-do-a-job is one of Sofía's journeys; companion is reachable at starter tier.
- **l2_priority:** Confirm a live companion turn renders the half-English card; measure whether the English status reads as "broken" vs "technical jargon she tolerates."

### [major][clarity] quality-gap — Persona capability / Behavior-Core editor is 100% English under `es`
- **expected:** The capability view (Mission, Identity, Role, Voice, Principles, Constraints + the AI coaching hints) — the surface where Sofía reviews/edits what her agent will do — renders in Spanish.
- **got:** Every label, placeholder, helper text, and coaching message renders English. `matrix_v3` is 0/83 translated in `es.json` (verbatim English copy). Example: `behavior_core_section_title` "Behavior Core", `mission_helper_text` "One sentence. What every capability ultimately serves.", the coach warning "This reads like a task. A mission is the unchanging purpose…".
- **evidence:** `src/i18n/locales/es.json` `matrix_v3` (all 83 leaves identical to `en.json`); consumers `src/features/agents/components/matrix/BehaviorCoreEditor.tsx:139-252`, `src/features/agents/sub_new_persona/capabilityView/**` (10 files reference `matrix_v3.*`).
- **code_check:** `confirmed-absent` — code references `t.matrix_v3.*` correctly; the `es` section is an untranslated mirror, so the deep-merge resolves every key to English. Data gap, not code.
- **reachable:** yes — directly on build-persona-from-intent (the review/edit step), starter tier.
- **l2_priority:** Confirm the editor paints English with `es` active; judge whether a whole English form on the "do I trust this?" step is adoption-killing for Sofía vs a tolerable one-time wince.

### [major][trust] quality-gap — Build progress + failure errors stream raw English from the backend
- **expected:** Build narration ("Processing turn…", "Awaiting input…", "Draft ready for review") and any build-failure error render in Spanish, especially the error.
- **got:** The Rust build-session emits English literal `message` strings that flow into `buildActivity`/`cliOutputLines` (the activity strip) and `buildError` (the red failure banner), rendered verbatim. The error banner is `{buildError}` with no localization layer.
- **evidence:** `src-tauri/src/engine/build_session/runner.rs:417` ("Processing turn {}..."), `:1031` ("Resolved: {}"), `:1068` ("Awaiting input: {}"), `:1378` ("Draft ready for review"); `events.rs:68` (`error.to_string()`); store wiring `src/stores/slices/agents/matrixBuildSlice.ts:758` (`error: event.message`); UI render `src/features/agents/sub_glyph/GlyphPrototypeLayout.tsx:516` (`{buildError}`), activity strip `GlyphSigilFace.tsx:140-141`.
- **code_check:** `confirmed-absent` — these strings never enter the i18n system (not tokens, not `t.*`); they are hardcoded English in Rust, surfaced raw. The progress strip is transient/technical (minor); the **failure error at a scary moment** is the trust hit (major).
- **reachable:** yes — build-persona-from-intent; any failed build shows the English banner.
- **l2_priority:** Trigger a real build failure under `es`; confirm the banner is English and judge trust impact. (Backend-token-or-error-registry localization is the fix path.)

### [minor][completion] confusion — No language control in Settings → Appearance (Sofía's stated mental model)
- **expected:** Sofía's character binding says her locale control lives at "Settings → Appearance (locale)". She'd go there to change/confirm her language.
- **got:** `AppearanceSettings.tsx` has only text-size, density, timezone, brightness, theming — **no language switcher**. The control lives only on Home (`LanguageSwitcher`) and in onboarding (`AppearanceStep`). A grep of `src/features/settings/**` for `setLanguage`/`i18nStore`/`Language` returns nothing.
- **evidence:** `src/features/settings/sub_appearance/components/AppearanceSettings.tsx:21-28` (section list, no language); absence confirmed by Grep over `src/features/settings`.
- **code_check:** `confirmed-absent` (in settings) — control is `present` elsewhere (Home/onboarding), so not a blocker, but a discoverability/mental-model mismatch: a returning user who wants to switch back to Spanish won't find it where the OS-app convention puts it.
- **reachable:** yes — Settings → Appearance is in Sofía's reachable set.
- **l2_priority:** Low. Confirm whether Home's switcher is discoverable enough on a return visit, or recommend adding a language section to Settings → Appearance.

### [minor][clarity] quality-gap — `debt` section (539 keys) is 0% translated; build-launch footer reads English
- **expected:** The "i18n debt" strings routed through `DebtText` (intentional debt-tracking bucket) render in Spanish.
- **got:** The entire `debt` section is a verbatim English copy in `es.json` (0/539 translated). Reachable example on the build journey: the build-launch footer hint — "Enter to summon agent / Shift+Enter for a new line" — composed from `debt.auto_*` keys via `DebtText`.
- **evidence:** `src/i18n/locales/es.json` `debt` (all 539 leaves identical to `en.json`); consumer `src/features/agents/sub_glyph/commandPanel/CommandPanelFooter.tsx:50-51`; mechanism `src/i18n/DebtText.tsx`.
- **code_check:** `by-design`/`confirmed-absent` — `DebtText` is the project's deliberate hardcoded-English holding pen; it's wired correctly but the `es` data is untranslated. Mostly low-traffic micro-copy; flagged because the bucket touches the build footer.
- **reachable:** partial — only specific `DebtText` call sites surface on Sofía's path; most `debt` keys are elsewhere.
- **l2_priority:** Low. Inventory which `debt` keys actually appear on Sofía's surfaces.

### [minor][trust] quality-gap — Onboarding desktop-scan error + interface-mode heading are English under `es`
- **expected:** Onboarding error and the "choose your interface" step render in Spanish.
- **got:** `onboarding.desktop_scan_error` "Could not scan your desktop.", `desktop_scan_error_hint` (English network-error hint), `interface_mode_heading` "Choose your interface", `interface_mode_description` "You can change this later in Settings." are untranslated in `es.json`.
- **evidence:** `src/i18n/locales/es.json` `onboarding` (27 untranslated leaves; these among them).
- **code_check:** `confirmed-absent` — translation lag; the scan-error one is a (minor) scary-moment-in-onboarding.
- **reachable:** yes — first-run-onboarding.
- **l2_priority:** Low. Translate the handful of onboarding stragglers.

### [polish][clarity] quality-gap — `models` effort labels untranslated
- **expected:** Model effort tiers "Low/Medium/High" render in Spanish where shown.
- **got:** `models.effort_low/medium/high/xhigh` are English in `es.json`. (Haiku/Sonnet/Opus correctly stay English — brand names.)
- **evidence:** `src/i18n/locales/es.json` `models` (7/7 identical).
- **code_check:** `confirmed-absent` for the effort labels; `by-design` for the model brand names.
- **reachable:** marginal — only where model picker shows effort.
- **l2_priority:** none.

---

## What passed (do not touch)

- **i18n architecture is sound for fallback safety.** The deep-merge `Proxy` guarantees no `undefined`/blank renders; partial `es` always degrades to English, never to broken UI (`src/i18n/useTranslation.ts`, CLAUDE.md i18n section).
- **Translated strings are native-quality.** Home greetings, onboarding intent guidance, director, error_registry read like a fluent native wrote them — clears Sofía's senior-quality bar for the translated surfaces.
- **Locale switch is reachable, prefetched, and persistent.** `LanguageSwitcher` + `AppearanceStep` prefetch on hover/focus (`useLanguagePrefetch`) and commit via `i18nStore.setLanguage`; Zustand `persist` + `onRehydrateStorage` make the choice stick across launches (`src/stores/i18nStore.ts:68-86`). `es` needs no custom font so there's no font-swap flash for her.
- **Core errors localized.** `errors` (100%) and `error_registry` (93%) are well-covered — the resolved/friendly error path (`resolveErrorTranslated`) lands in Spanish.
- **Companion retry + intent entry localized.** The build intent box and the companion's retry affordance are translated, so the *interactive* controls (not the status read-outs) speak Spanish.

---

## Character voice

"Empecé bien — la bienvenida, el tour, todo en español de verdad, no traducción de máquina. Eso me dio confianza. Pero en cuanto le pedí a Athena que hiciera el trabajo, la tarjeta me dice `running…` y `done` en inglés y abajo el botón dice 'Reintentar' — ¿entonces está en español o no? Cuando una herramienta se rinde a medias justo donde está *enviando* cosas, dejo de confiar en lo que acabo de hacer.

Y lo que más me molestó: armé mi agente, abro la vista para revisar qué va a hacer — Mission, Identity, Voice — y *todo* está en inglés. Esa es justo la pantalla donde necesito entender antes de soltarlo. Si la construcción falla, el error rojo también en inglés. Lo terminé, sí, pero no me sentí respetada de punta a punta. Y fui a Ajustes → Apariencia a cambiar el idioma y ni siquiera está ahí.

Verdict: la base traducida es excelente — no la toquen. Pero `matrix_v3` y el estado del companion en inglés son el muro: la app me habla español hasta que llega el momento que importa, y ahí se cambia a inglés. Eso, para mí, cuesta adopción."
