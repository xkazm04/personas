# UI Perfectionist Scan — personas, 2026-06-13

> Visual-quality / readability / interface-impression audit toward a world-class experience.
> 14 parallel UI-Perfectionist subagent runs (UI-heavy subset of 30 contexts), batched in 2 waves of 8 + 6.
> Every finding judged against the existing design system (199-component catalog + `lib/design` tokens).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 14 contexts | 5 | 52 | 57 | 14 | **128** |
| Share | 4% | 41% | 44% | 11% | 100% |

**By category** (this is the real story):

| Category | Count | Share | What it means |
|---|---:|---:|---|
| **reuse** | 57 | 45% | Hand-rolled UI where a catalog component already exists |
| **token** | 35 | 27% | Raw colors/borders duplicating `statusTokens`/`listTokens` |
| hierarchy | 14 | 11% | Type-ramp / spacing / contrast weakening readability |
| state-coverage | 10 | 8% | Missing loading / empty / error states |
| a11y | 7 | 5% | Focus/aria/tooltip gaps on interactive elements |
| polish | 5 | 4% | Transitions, hover, alignment nits |

**Headline:** the design system is *excellent and mature* — the problem is **uneven adoption**.
72% of findings are "use the thing that already exists." The fix is overwhelmingly *adoption and
unification*, not new design. Sibling surfaces frequently disagree (e.g. incidents uses
`StatusShape`/`StatusBadge` correctly while manual-review one folder over hand-draws SVGs; Obsidian
plugin uses the catalog while Artist hand-rolls everything). Closing this drift is exactly what
"world-class consistency" requires.

---

## Per-context breakdown

(Sorted by criticals desc, then total.)

| # | Context | Crit | High | Med | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | persona-chat-conversations | 1 | 4 | 4 | 1 | **10** | [report](persona-chat-conversations.md) |
| 2 | creative-productivity-plugins | 1 | 4 | 3 | 1 | **9** | [report](creative-productivity-plugins.md) |
| 3 | onboarding-home-welcome | 1 | 3 | 4 | 1 | **9** | [report](onboarding-home-welcome.md) |
| 4 | reviews-incidents-audit | 1 | 3 | 4 | 1 | **9** | [report](reviews-incidents-audit.md) |
| 5 | templates-and-build-sessions | 1 | 4 | 3 | 1 | **9** | [report](templates-and-build-sessions.md) |
| 6 | settings-api-keys-byom | 0 | 5 | 4 | 1 | **10** | [report](settings-api-keys-byom.md) |
| 7 | agent-memories-knowledge | 0 | 4 | 4 | 1 | **9** | [report](agent-memories-knowledge.md) |
| 8 | companion-athena | 0 | 3 | 5 | 1 | **9** | [report](companion-athena.md) |
| 9 | credential-vault-connectors | 0 | 4 | 4 | 1 | **9** | [report](credential-vault-connectors.md) |
| 10 | events-messages-notifications | 0 | 3 | 5 | 1 | **9** | [report](events-messages-notifications.md) |
| 11 | execution-engine-runs | 0 | 4 | 4 | 1 | **9** | [report](execution-engine-runs.md) |
| 12 | overview-dashboard-metrics | 0 | 3 | 5 | 1 | **9** | [report](overview-dashboard-metrics.md) |
| 13 | recipes-automation-library | 0 | 4 | 4 | 1 | **9** | [report](recipes-automation-library.md) |
| 14 | triggers-and-event-automations | 0 | 4 | 4 | 1 | **9** | [report](triggers-and-event-automations.md) |

---

## The 5 critical findings

All five are whole-surface **reuse** breaks — one surface re-implements a system primitive,
producing both a maintenance fork and a visible inconsistency with the rest of the app.

1. **persona-chat — `ChatMessageContent` re-implements all of `MarkdownRenderer`** (~247 lines of
   forked ReactMarkdown/code-block/copy logic). `src/features/agents/components/ChatMessageContent.tsx`.
   → adopt `MarkdownRenderer` with `codeBlockActions`.
2. **creative-plugins — Artist hand-rolls the entire UI vocabulary** (raw buttons, custom spinners /
   status dots, zero focus-ring) while Obsidian one tab over uses the catalog.
   `src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx` (+ GalleryPage).
3. **onboarding — Cockpit load-failure is a hand-rolled red block** with a bespoke Retry button and
   hardcoded English on the flagship first-impression surface.
   `src/features/home/sub_cockpit/CockpitPanel.tsx:179`. → `ErrorBanner` + `Button` + i18n.
4. **reviews — manual-review `SeverityIndicator` hand-draws inline SVGs** with raw `rgba()` severity
   colors instead of `StatusShape`/`statusTokens` (which incidents, one folder over, already uses).
   `src/features/overview/sub_manual-review/components/ReviewListItem.tsx:8`.
5. **templates — n8n wizard hand-rolls every `<button>`** with a private violet/emerald variant
   vocabulary while the preset half uses catalog `Button` — two button idioms in one feature.
   `src/features/templates/sub_n8n/widgets/N8nWizardFooter.tsx` (+ ConnectorRow, N8nSessionList, SuccessBanner).

---

## Triage themes (→ fix-wave split)

Findings cluster into 8 coherent themes. Each is a wave with ONE mental model, so fixes compound.

| Wave | Theme | Mental model | Approx count |
|---|---|---|---:|
| **1** | **Status & severity tokens** | Replace raw status/severity colors with `statusTokens` + `StatusBadge`/`StatusDot`/`StatusShape`; unify row borders to `ROW_SEPARATOR`. | ~30 |
| 2 | Button reuse | Replace hand-rolled `<button>` with `Button`/`AsyncButton`. *(criticals 2,5)* | ~18 |
| 3 | Error / empty / loading states | Adopt `ErrorBanner` / `EmptyState` / `LoadingSpinner` / `*Skeleton`. *(critical 3)* | ~15 |
| 4 | Markdown / number / time reuse | `MarkdownRenderer`, `Numeric`, `RelativeTime`/`AbsoluteTime`. *(critical 1)* | ~14 |
| 5 | List / table reuse | `UnifiedTable` / `GroupedVirtualList` / `VirtualStream` instead of hand-built grids. | ~12 |
| 6 | Form / input reuse | `FormField` / `Listbox` / `PasswordToggleField` / `SettingRow` / `AccessibleToggle`. | ~12 |
| 7 | Hierarchy & typography | Type-ramp adherence, secondary-text contrast, spacing rhythm, section structure. *(critical 4 fits here too)* | ~14 |
| 8 | Polish & a11y | `focus-ring`, `Tooltip` over `title=`, hover/transition states, icon alignment. | ~13 |

(Counts are approximate — some findings span two themes and are placed by primary category.)

---

## Suggested next-phase split

Run waves **in this order** — earlier waves are higher-leverage and lower-risk, and they establish
the token/primitive habits the later waves lean on:

- **Wave 1 (status tokens)** — biggest cross-app consistency win, lowest regression risk, touches the
  most-seen surfaces (overview, executions, vault, triggers, reviews, settings, memories). Start here.
- **Wave 2 (buttons)** then **Wave 3 (states)** — close 2 more criticals; high visible payoff.
- **Wave 4 (markdown/number/time)** — closes the last 2 criticals; the chat-markdown one is a larger refactor, isolate it.
- **Waves 5–6 (lists, forms)** — structural reuse; medium effort.
- **Waves 7–8 (hierarchy, polish/a11y)** — the final coat that makes it feel world-class.

Each wave is one focused session of 5–7 fixes; large criticals (chat markdown, Artist surface) may be
a session on their own.

---

## How this scan was run

- **Scanner**: `ui-perfectionist` (`src/lib/prompts/registry/agents/ui-perfectionist.ts`), scanType `ui_perfectionist`.
- **Date**: 2026-06-13. **Project**: personas (`C:\Users\kazda\kiro\personas`), Tauri + Next.js 16 / React 19 / Tailwind 4.
- **Scope**: client-side only (`src/features/**` .tsx/.css); `src-tauri/`, `api/`, `stores/` descoped. UI-heavy subset of 14 of 30 contexts (backend-only contexts skipped).
- **Method**: 14 isolated `general-purpose` subagents, each grounded in `_REFERENCE.md` (the design-system brief), each writing one report, replying with terse stats only.
- **Verification**: counts reconciled two ways — header-sum (128) and per-finding Severity-bullet count (128, after excluding the reference-template line).
- **Baseline health** (pre-fix): 4 pre-existing TS errors; this scan modified zero source files.
