> Context: triggers/triggers [1/3]
> Total: 9
> Critical: 0  High: 0  Medium: 4  Low: 5

## 1. Clearing a time-range input writes NaN into the active-window config
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/triggers/sub_triggers/ActiveHoursSection.tsx:200-216
- **Scenario**: Both `<input type="time">` onChange handlers do `const [h, m] = e.target.value.split(':').map(Number)`. When the user clears the field (native clock "clear" or delete), `e.target.value` is `''`; `''.split(':')` → `['']`, `.map(Number)` → `[0]`, so `h=0` and `m=undefined` → `Number(undefined)` = `NaN`. `update({ start_hour: 0, start_minute: NaN })` then persists `start_minute: NaN`.
- **Root cause**: No guard that the split produced two valid numeric parts; assumes the time input is always a well-formed `HH:MM`.
- **Impact**: `NaN` is serialized to `null` when the config crosses the Tauri IPC boundary (JSON.stringify(NaN) → "null"), corrupting the persisted `active_window`. On reload `parseActiveWindow` keeps `NaN` (typeof NaN === 'number'), and `formatTime` renders `"09:NaN"` in the summary badge.
- **Fix sketch**: Parse defensively: `const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h) && Number.isFinite(m)) update({ start_hour: h, start_minute: m });` (or fall back to the previous value).

## 2. Polling trigger can be created with an empty endpoint and no event — a silent no-op
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts:67-71
- **Scenario**: For `triggerType === 'polling'`, the builder validates only the interval (`>= 60`). It then does `if (s.selectedEventId) { config.event_id = ... } else { config.endpoint = s.endpoint }` with no check that `s.endpoint` is non-empty. `TriggerAddForm`'s `isScheduleInvalid` guard only covers `schedule`, not `polling`, so Create succeeds and produces `{ interval_seconds, endpoint: '' }`.
- **Root cause**: Every other config branch that needs a target (file_watcher path, event_listener type, composite conditions) returns a validation error when it is empty; the polling branch omits that check.
- **Impact**: User creates a polling trigger that polls nothing and never fires, with no error surfaced — classic Success Theater at trigger-creation time.
- **Fix sketch**: In the polling branch, `if (!s.selectedEventId && !s.endpoint.trim()) return { ok: false, error: v.endpoint_required }` (add the translation key).

## 3. "every 0 minutes/hours" silently falls back to 3600s with no warning
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/triggers/sub_triggers/nlTriggerParser.ts:71-77, 337-345
- **Scenario**: `parseInterval("run every 0 minutes")` returns `0 * 60 = 0`. In the schedule `extract`, `const interval = parseInterval(...); if (interval) {...}` — `0` is falsy, so it skips the interval branch and returns the default `interval: '3600'`. The sub-minute path emits an `interval_clamped` warning, but the zero-unit path emits none.
- **Root cause**: Truthiness check `if (interval)` conflates a legitimate `0` result with "no interval parsed"; and only the `second` unit branch warns on out-of-range values.
- **Impact**: The user types "every 0 minutes", the UI silently shows/accepts a 1-hour schedule with no advisory — the exact Success-Theater class the warning system was built to prevent.
- **Fix sketch**: Return `null` explicitly for non-positive parsed intervals, or push an `interval_clamped`-style warning for sub-minute minute/hour values too; use `if (interval !== null)` rather than `if (interval)`.

## 4. Countdown ring stays stuck on "FIRE" indefinitely when next_trigger_at is never refreshed
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/triggers/sub_triggers/TriggerCountdown.tsx:86-104
- **Scenario**: `firing` is only true for `remaining` in `(-2, 0]`, but the render path is `if (firing || remaining <= 0)` → shows the FIRE label for *any* `remaining <= 0`. If the backend never advances `next_trigger_at` (scheduler paused, trigger left enabled with a stale past `next_trigger_at`, or fallback compute from `last_triggered_at + interval` that stays in the past), the ring renders "FIRE" forever.
- **Root cause**: The "briefly show fire state" comment intends a 2-second window, but the fallback `|| remaining <= 0` defeats it; there's no upper bound on how long the fire state persists.
- **Impact**: Misleading UI — a dormant/paused trigger appears to be perpetually firing. Cosmetic, no data effect.
- **Fix sketch**: Bound the fire render to the firing window, e.g. show FIRE only while `firing`, and for `remaining <= -2` fall back to a "pending"/"overdue" label instead of FIRE.

## 5. Duplicated JSON payload block component (JsonBlock vs PayloadBlock)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/triggers/sub_triggers/WebhookRequestInspector.tsx:50-66 & src/features/triggers/sub_triggers/TriggerExecutionHistory.tsx:16-34
- **Scenario**: `JsonBlock({label,data})` and `PayloadBlock({label,data})` are byte-for-byte identical in logic — same `if (!data) return null`, same `JSON.stringify(JSON.parse(data), null, 2)` try/catch, same `<pre>` markup. They differ only in the label's typography class (`typo-label` vs `typo-body`). Verified both are local, non-exported components used only within their file.
- **Root cause**: Two inspectors implemented independently instead of sharing one primitive.
- **Impact**: Maintainability — any fix (e.g. handling non-string data, truncation, copy button) must be made twice.
- **Fix sketch**: Extract a shared `JsonPayloadBlock` (into a small display component under features/shared or the triggers folder) with an optional `labelClassName` prop; delete both copies.

## 6. Dead export: formatRunTimeUTC is never used
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/triggers/sub_triggers/TriggerSchedulePreview.tsx:31-39
- **Scenario**: `formatRunTimeUTC` is exported but a repo-wide grep finds only its own definition — no importers, no in-file callers. Both preview components use `formatRunTime` (local time) exclusively.
- **Root cause**: Leftover from an earlier UTC-display iteration that was dropped.
- **Impact**: Maintainability / dead surface area.
- **Fix sketch**: Delete the function.

## 7. Schedule-preview timeline duplicated (intra-file and cross-module)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/triggers/sub_triggers/TriggerSchedulePreview.tsx:41-161
- **Scenario**: `SchedulePreview` and `CronSchedulePreview` in this file contain near-identical "Mini timeline" JSX (track, "now" marker, run-dot map with `pct` positioning) differing only in primary vs amber accent classes. Separately, `formatRunTime` + a `SchedulePreview` component are also duplicated in src/features/agents/sub_use_cases/libs/scheduleHelpers.ts:45 and src/features/agents/sub_use_cases/components/schedule/SchedulePreview.tsx — same helper name and same timeline pattern.
- **Root cause**: Timeline widget copy-pasted per surface and per accent color instead of parameterized.
- **Impact**: Maintainability — timeline/positioning bugs and design tweaks must be fixed in 3+ places; the `formatRunTime` helper exists twice.
- **Fix sketch**: Extract a `ScheduleTimeline({ runs, accent })` component and a single shared `formatRunTime`; have both cron/interval previews (and the agents schedule preview) consume them.

## 8. Pointless ternary + hardcoded operator labels in CompositeConfig
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/triggers/sub_triggers/CompositeConfig.tsx:69-89
- **Scenario**: `label={t.triggers.op_all_label ? 'Operator' : 'Operator'}` — both branches return the same literal `'Operator'`, so the condition is inert. The `op_all_label` translation key exists and is localized in every locale file, but here it is only used as a truthiness probe and the heading is hardcoded English. The operator button labels ('ALL (AND)', 'ANY (OR)', 'Sequence') and their `desc` tooltips are also hardcoded English instead of using translations.
- **Root cause**: Half-finished i18n wiring left a no-op ternary behind.
- **Impact**: Maintainability + missing localization for the operator UI.
- **Fix sketch**: Replace with a plain translated label and route the operator button/tooltip strings through `t.triggers.*` (op_all_label already exists for the ALL option).

## 9. Redundant timeToInput wrapper
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/triggers/sub_triggers/ActiveHoursSection.tsx:61-67
- **Scenario**: `timeToInput(hour, minute)` is a one-line wrapper whose body is `return formatTime(hour, minute);` — identical signature and output to `formatTime`. Both are used in this file; the wrapper adds no behavior.
- **Root cause**: Presumably an earlier divergence (e.g. `HH:MM` for input vs display) that was reconciled but left the alias.
- **Impact**: Maintainability — a needless indirection.
- **Fix sketch**: Delete `timeToInput` and call `formatTime` directly in the two `<input type="time">` `value` props.
