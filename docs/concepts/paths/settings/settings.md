---
layer: golden-path
subject: settings
status: forged
techniques:
  - key-registry
  - typed-accessors
  - read-batching
  - setting-kinds
  - settings-audit-and-history
  - save-experience
evidence:
  - src-tauri/db/src/settings_keys.rs                 # the registry: key constants + paired _DEFAULT constants, exact-key allowlist + governed prefix families, per-key typed value validation (JSON blobs against the consumer's own struct), audit categories, audit-excluded bookkeeping keys, deprecated-key quarantine
  - src-tauri/db/src/repos/core/settings.rs           # the one validation door at the repo layer (internal callers cannot bypass); audit emitted here so ALL writers are audited; before-value capture, no-op suppression, best-effort audit; idempotent delete contract
  - src/api/system/settings.ts                        # bulk read collapsing mount-time fan-out (~1-5ms per invoke motivates it); idempotent-delete caller contract; category-scoped audit listing
  - src/hooks/utility/data/useSettings.ts             # microtask coalescer — same-tick single-key reads flush as ONE bulk call; key-only settings-changed event refreshes other mounted readers
  - src/hooks/utility/data/useAppSetting.ts           # per-key accessor hook: load-on-mount via the coalescer, validate-else-default, save-with-feedback, empty-write = delete (reset restores the default)
  - src/features/settings/sub_history/components/SettingsHistoryTab.tsx   # the history surface: category filter, before→after rows, warm module cache
  - src/features/settings/shared/RecentChangeChip.tsx # recent-change visibility at the scene — last audit entry per category, deep-links to history
  - src/features/settings/search/useSettingsSearchEntries.tsx  # settings search: toggles flip inline, everything else deep-links to its owning tab
  - src/lib/appearanceMirror.ts                       # debounced write-through mirror — the durable settings row backs the fast local copy after a profile clear wiped user choices
counter_evidence:
  - src-tauri/db/src/settings_keys.rs                 # the SAME registry file carries the fail-open convention: MONTHLY_COST_CEILING_USD / CHAIN_MAX_COST_USD default 0.0 documented as "no ceiling" — the unconfigured state is the most permissive state (registered at w2-hitl-approval); contrast CHAIN_MAX_LINKS, whose UNSET falls back to an always-on cap and only an explicit "0" disables
deviations:
  - w9-settings   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval   # dollar ceilings fail open (0/None = unlimited) while switches fail closed — registered on the gating subject; cited here as the fail-direction evidence, not re-registered
---

# Settings & preferences

A settings store is the application's memory of what the operator decided: a
key-value substrate that everything else reads. It is the highest fan-in state
in the system — rendering, scheduling, spending, safety, and sync all consult
it — and it is deceptively easy to build, because the naive version is four
functions (get, set, delete, list) over a table of strings. The naive version
also works, for months. Its failures arrive later, and they arrive silently,
because of the one property that makes a settings store unlike every other
store in the application:

**Reads never fail loudly.** A settings read that finds nothing returns a
default, by design — the application must boot on an empty store. That single
property, essential and non-negotiable, converts every mistake in the vicinity
into a plausible value. A typo'd key does not error; it returns the default. A
key that was renamed does not error; the old value sits orphaned while reads of
the new name return the default. A corrupted value does not error, if the
accessor swallows the parse failure; it returns the default. In every other
subsystem, a wrong name is a crash; here, a wrong name is a quietly different
application. **Misconfiguration is indistinguishable from configuration** —
unless the store is built, deliberately, to make them distinguishable. That is
what this subject is about.

Five commitments follow, one per failure mode of the naive store.

## The key space is a registry, not a convention

A store keyed by free strings has an unbounded key space, and an unbounded key
space accumulates exactly two kinds of garbage: **typos**, which read as
defaults forever (the write went to `notifcations_enabled`, the read asks for
`notifications_enabled`, both succeed, nobody is notified), and **orphans** —
keys whose reading code was deleted or renamed, whose stored values persist
indefinitely because nothing errors on an unread row.

The fix is structural, not disciplinary
([one-validation-door](../_laws.md#one-validation-door)): the set of legal
keys is a closed vocabulary with one authoritative definition
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)),
enforced at **both ends of the pipe** — callers reference named constants so a
typo is a compile-time error, and the store itself rejects writes of
unregistered keys so the constant layer cannot be bypassed by a caller that
skips it. A registry also makes the orphan problem *solvable*: diff the
registry against the stored rows and every stale key surfaces; without a
registry the question "which of these rows is dead?" has no computable answer.
The full discipline — registration, namespacing, rename migration, reaping —
is the [key-registry](techniques/key-registry.md) technique.

## Every read is typed, and every default is a decision

The store holds serialized values; the *types* live at the read boundary. A
raw string handed to twelve call sites is twelve parses and twelve opinions
about what malformed means. The correct shape is one typed accessor per key —
parse, validate, clamp, default — so the store's stringly nature is a private
implementation detail behind a typed door.

The default deserves more respect than it usually gets. A default is not a
fallback of last resort; it is **the value most installations run with**,
because most users never open the settings surface. It is a product decision
with an owner and a rationale, and it deserves to be written where decisions
live — in code, reviewed, next to a sentence saying why — not discovered
empirically in production.

And the default has a **fail direction**. When the key is a preference, a
wrong default is a cosmetic annoyance. When the key is a safety ceiling, the
default is what the limit becomes when nothing was configured — and a spending
ceiling that defaults to *unlimited* fails open: the state "nobody set a
budget" silently becomes the state "there is no budget". The canonical
evidence is already registered on the neighbouring subject: the
[hitl-approval](../hitl-approval/hitl-approval.md) audit found dollar ceilings
where zero-or-absent meant unlimited while the boolean switches around them
failed closed — two fail directions in one settings surface, and the dangerous
one on the dangerous key. Safety-relevant defaults fail *safe*: absent ceiling
means zero, not infinity. The full rule set is
[typed-accessors](techniques/typed-accessors.md).

## Reads are batched

Because everything reads settings, settings reads happen at the worst moment:
startup, when dozens of components mount at once and each asks for its keys.
If each read is a round trip across a process or storage boundary, boot pays a
fan-out tax that grows with every feature — measurable, and entirely
self-inflicted, because the values are tiny and were all in one table the
whole time. The remedy is a bulk read that loads the space (or a namespace) in
one round trip into a cache, with invalidation on write so the cache never
silently diverges from the store
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
The mechanics — bulk endpoints, single-flight, write-through, cross-window
staleness — are [read-batching](techniques/read-batching.md).

## Writes are observable

"What changed recently?" is the first question of every debugging session that
begins with "it worked yesterday" — and in a settings-driven application, the
honest answer is usually a setting. A store that cannot answer that question
turns every configuration change into an unfalsifiable suspect. So every write
is recorded: which key, old value, new value, when, from where, under which
category — and the record is *surfaced*, not merely stored: a history view
grouped by category, and recent-change markers on the settings surface itself,
so the drifted knob is visible at the scene. The ledger mechanics (append-only
discipline, retention, redaction) belong to
[audit-logging](../audit-logging/audit-logging.md); what this subject owns is
the settings-shaped surface on top —
[settings-audit-and-history](techniques/settings-audit-and-history.md).

## One store, several contracts

"Settings" is one word for at least four kinds of key, and the kinds have
different rules:

| Kind | Example | Wrong-value blast radius | Fail direction of the default |
| --- | --- | --- | --- |
| **User preference** | theme, density, language | one annoyed user | any reasonable value |
| **Operational config** | endpoint, interval, concurrency | degraded or broken behavior | the conservative value |
| **Safety ceiling** | spend cap, rate cap, autonomy level | unbounded machine action | **closed — always** |
| **Feature flag** | staged rollout, experiment | inconsistent behavior | off |

Treating all four as one contract is how a spend cap ends up edited as
casually as a theme toggle. The kind is declared in the registry, and per-kind
rules follow — who may write it, how strictly it validates, how loudly it
audits, whether changing it demands confirmation or a gate. Ceilings in
particular are only *stored* here; their **enforcement semantics** — the gate
that consults them, what happens at the boundary — belong to
[hitl-approval](../hitl-approval/hitl-approval.md). The taxonomy and per-kind
contract table is [setting-kinds](techniques/setting-kinds.md).

## Stale keys are reaped

Every registered key names its lifecycle
([creation-names-reaper](../_laws.md#creation-names-reaper)): a rename ships a
migration that moves the stored value, or the user's choice silently reverts
to the default — a data-loss bug that no error will ever report; a retirement
deletes the registry entry *and* the stored rows, idempotently. The registry
is what makes reaping mechanical: orphan detection is a set difference, run as
a periodic check rather than an archaeology project. A store that only ever
grows is not accumulating configuration; it is accumulating doubt about which
rows still mean anything.

## The save experience

Settings surfaces have a UX contract of their own: writes should feel
immediate but must be honest. Debounced saves with visible confirmation;
failed writes that say so rather than pretending
([failure-not-empty-success](../_laws.md#failure-not-empty-success)); guards
on navigation away from unsaved explicit-save forms; search over a settings
surface that has outgrown scrolling. These are
[save-experience](techniques/save-experience.md).

## Boundaries

- **Client-side persistence mechanics** — how UI state stores persist,
  version, and migrate their own slices — belong to
  [client-state](../client-state/techniques/persistence-and-migration.md).
  This subject owns the *application* settings store: the durable, backend-
  held key space. The practical rule: if the value must survive
  reinstallation or drive backend behavior, it is a setting; if it is
  view-state ergonomics (panel widths, collapsed sections), it is client
  state.
- **Appearance token systems** — what theme values *are* and how they cascade
  — belong to [design-tokens](../design-tokens/design-tokens.md). The setting
  stores *which* theme the user picked; the token system defines what that
  choice means.
- **Gating semantics of autonomy ceilings** — what enforces a ceiling and
  what happens at the boundary — belong to
  [hitl-approval](../hitl-approval/hitl-approval.md). This subject owns the
  storage, typing, and fail direction of the ceiling *value*.
- **Ledger discipline** — append-only writes, retention, querying — belongs
  to [audit-logging](../audit-logging/audit-logging.md).
- **Secrets are not settings.** Credentials, tokens, and anything deserving
  encryption live in the [credential-vault](../credential-vault/credential-vault.md);
  a settings store is plaintext by design and must refuse the temptation to
  hold "just one API key". If a value would be redacted in a log, it does not
  belong here.

## The techniques

- [key-registry](techniques/key-registry.md) — the closed key space:
  constants, store-side allowlist, namespacing, rename migration, orphan
  detection.
- [typed-accessors](techniques/typed-accessors.md) — one typed door per key:
  parse/validate/clamp on read, defaults as owned decisions, the
  fail-direction rule.
- [read-batching](techniques/read-batching.md) — collapsing the boot fan-out:
  bulk reads, caching, invalidation on write.
- [setting-kinds](techniques/setting-kinds.md) — preference / operational /
  ceiling / flag: one store, per-kind contracts.
- [settings-audit-and-history](techniques/settings-audit-and-history.md) —
  category-tagged change records, history surfaces, recent-change visibility.
- [save-experience](techniques/save-experience.md) — debounced honest saves,
  unsaved guards, settings search.
