# UI Perfectionist — Fix Wave 6 — Form-control reuse (native `<select>` → `ThemedSelect`)

> 2 commits, 2 high findings closed (3 `<select>` sites across 3 files).
> Baseline preserved: TS errors 0 → 0. eslint clean on all changed files (pre-commit hook).
> One mental model: native form controls → catalog form components.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `318c65027` | triggers #1 — raw `<select>` both tabs | high | CloudWebhooksTab.tsx, SmeeRelayTab.tsx |
| 2 | `25903ab4d` | recipes #3 — raw `<select>` | high | RecipeEditor.tsx |

## What was fixed

1. **Trigger persona pickers → `ThemedSelect`.** The cloud-webhook picker (private blue focus-ring) and
   the Smee-relay route-to-agent picker (private purple focus-ring) were native `<select>`s that disagreed
   with each other and the catalog. Both now use `ThemedSelect` — shared chevron, `focus-ring`, themed
   `<option>` styling — by dropping the bespoke classes and keeping the `<option>` children.
2. **Recipe category picker → `ThemedSelect`.** RecipeEditor's category selector had a hand-rolled
   border/focus style; now the catalog select.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` errors | 0 | **0** |
| eslint (changed files) | — | clean (pre-commit) |

## Patterns established (catalogue item 10)

10. **Native `<select>` → `ThemedSelect` is a drop-in.** `ThemedSelect extends SelectHTMLAttributes`,
    renders `<option>` children as-is, and supplies the chevron + `focus-ring` + themed-option styling.
    Swap the tag and delete the bespoke `className` (don't re-pass border/focus utilities — they fight the
    component's own). Use `Listbox`/`FilterableSelect` only when you need search or non-native option UI.

## DESCOPED / left for follow-up (this theme)

- **credential-vault #1 (high) — secret fields → `PasswordToggleField`.** `FieldCaptureRow`'s show/hide is
  entangled with the shared `FieldActionButtons` eye-toggle + copy/paste header; adopting
  `PasswordToggleField` means restructuring two components and verifying mask-on-blur in a running app
  (not `tsc`-verifiable). Dedicated-session item.
- **SchemaFieldBuilder type-`<select>`** (part of recipes #3): left native to avoid row-height misalignment
  in its compact field-builder grid (ThemedSelect's `py-2` is taller than the row's `py-1.5` inputs).
- Remaining form findings: settings #2 (`SettingRow`), #5 (`FormField`/`DesignInput`), #6 (catalog
  checkboxes/toggles), #9 (engine toggles); templates #4 (`PresetQuestionnaireForm` select); memories #9
  (Annotate/MemoryDetail inputs); events #7 (search input).

## What remains overall

Waves 3 (states), 5 (lists/tables), 7 (hierarchy/typography), 8 (polish/a11y) untouched; plus the two
critical whole-surface refactors (Artist; chat `MarkdownRenderer`) flagged for app-run sessions.
