# overview/certification — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 13 | Missing: 0

## 1. Unstable `Math.random()` row keys force full row remounts on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_certification/components/GroundingTable.tsx:76 (also JudgePanel.tsx:97)
- **Scenario**: `getRowKey={(row) => row.file ?? Math.random().toString(36)}` and `key={p.personaId ?? p.role ?? Math.random()}` mint a NEW key on every render for any row with a null file/id. Any parent re-render (tab state, translation, refresh spinner toggling) unmounts and remounts those rows and their Tooltips.
- **Root cause**: `Math.random()` used as a key fallback instead of a stable derived key; the key function runs per render, so the fallback is never stable.
- **Impact**: Rows with null `file`/`personaId` are destroyed/recreated on every render — lost tooltip/hover state, wasted DOM churn, and it defeats React reconciliation entirely for those rows. Silent because it only bites on null identity fields.
- **Fix sketch**: Use the array index as the fallback: `getRowKey={(row, i) => row.file ?? \`row-${i}\`}` (UnifiedTable passes index; if not, key off `grounding.indexOf` via a mapped wrapper). In JudgePanel map with `(p, i)` and use `key={p.personaId ?? p.role ?? \`persona-${i}\`}`. The lists are static per detail load, so index keys are safe here.

## 2. `GateRow` and `RuleRow` are near-duplicate tri-state status rows
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_certification/components/GateBreakdown.tsx:9 (dup: StandardsCard.tsx:37)
- **Scenario**: Both components render the identical pass/fail/na pattern — `Icon = pass ? Check : fail ? X : Minus`, the same `text-emerald-400`/`text-rose-400`/`text-zinc-500` color ternaries, the same status-label ternary, the same `flex items-center gap-2 py-1.5` row with an optional dotted-underline Tooltip trailer.
- **Root cause**: The tri-state gate-row visual was re-implemented for standards rules instead of extracting the shared shell when StandardsCard was added.
- **Impact**: ~25 duplicated lines; any styling or a11y change to gate rows must be made twice and has already started drifting (GateRow has a CopyButton, RuleRow a truncated basis) — the shared skeleton is identical and will keep diverging.
- **Fix sketch**: Extract a `StatusRow({ status, label, trailing })` component (in this folder) that owns the icon/color/status-label logic for `'pass' | 'fail' | null/'na'`, taking `trailing?: ReactNode` for the log-copy vs basis-tooltip variants. Rewrite GateRow and RuleRow as thin wrappers.

## 3. Verdict constant maps duplicated across three files
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_certification/components/VerdictBadge.tsx:6 (dups: RunHistoryView.tsx:10, TeamCertCard.tsx:7-13)
- **Scenario**: The verdict vocabulary (`PRODUCTION | PROMISING | NOT-READY | BROKEN`) is hardcoded three times: `VERDICT_ACCENT` (badge color), `VERDICT_RANK` (sort order), `VERDICT_ORDER` + `VERDICT_BAR` (distribution bar order + color). Adding or renaming a verdict in the Rust bundle format requires touching all three in lockstep.
- **Root cause**: Each component grew its own verdict map instead of a single `verdicts.ts` module owning the ordered list and per-verdict accents.
- **Impact**: Three-way drift hazard; rank and order encode the same severity ordering twice, and the emerald/amber/rose/red color assignment is repeated in both Tailwind-class and accent-token form.
- **Fix sketch**: Add `sub_certification/verdicts.ts` exporting `VERDICTS = ['PRODUCTION','PROMISING','NOT-READY','BROKEN'] as const` plus a per-verdict record `{ accent, barClass }`; derive `VERDICT_RANK` from array position. Import from the three consumers.

## 4. Table column definitions rebuilt (with i18n closures) on every render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_certification/components/RunHistoryView.tsx:57 (also GroundingTable.tsx:19)
- **Scenario**: The `columns` arrays — six objects with fresh `render`/`sortFn` closures — are recreated inline on each render of RunHistoryView/GroundingTable, so `UnifiedTable` receives new column identities every time its parent re-renders (tab switch, refresh spinner tick).
- **Root cause**: Column specs declared in the component body without `useMemo`, capturing the translation object.
- **Impact**: Bounded — data here is dev-only eval runs — but it guarantees UnifiedTable can never bail out on column identity and re-runs sort comparators per render; it also sets the pattern other tables copy.
- **Fix sketch**: Wrap each `columns` array in `useMemo(() => [...], [c])` (the translation slice is the only captured dependency). Two-line change per file, no behavior change.
