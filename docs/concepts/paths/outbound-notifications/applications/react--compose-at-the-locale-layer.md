---
layer: application
subject: outbound-notifications
technique: compose-at-the-locale-layer
stack: react
---

# Compose at the locale layer — one good door with one caller, five doors total (Personas)

The technique's placement rule and one-door enforcement as they stand
across the OS-notification tier: the exemplar
`src/lib/notifications/notifyProcessComplete.ts`, the locale-less Rust
door `src-tauri/src/notifications.rs`, and the measurement that frames
both (legacy `docs/concepts/golden-paths/desktop-notification.md` §0,
measured 2026-08; the deviation itself is registered at
`#w3-toasts-notifications`, since the OS tier is that subject's
[os-escalation](../../toasts-notifications/techniques/os-escalation.md)
technique).

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Compose from the live catalog at send time | `notifyProcessComplete(opts, t)` (`notifyProcessComplete.ts:36-52`): title = `getProcessLabel(processType, t)` + `t.process_labels.complete_suffix / failed_suffix`; the caller passes the live `t`, and `PROCESS_LABEL_KEYS` binds each of 14 process types to a catalog key |
| Durable record outside the fallible attempt | the OS send is inside `try` (`:54-63`) with `silentCatch`; `addProcessNotification` into the notification-center store runs **after and outside** it (`:66-74`), so a denied/missing/crashed OS layer still leaves the entry under the title-bar bell |
| Lazy permission at send | `isPermissionGranted()` → `requestPermission()` only when needed, only at delivery (`:55-59`) — never on mount |
| Deep link carried as data | `redirectSection` / `redirectTab` on the record — the message points somewhere, not "click to…" prose |
| The locale-less door | `crate::notifications::send(app, title, body)` (`notifications.rs:1543-1547`) — takes already-composed strings; the module has zero occurrences of `locale` / `i18n` / `translat` |

## Judgment calls worth copying

- **The catalog is a parameter, defaulting to English.** `t: Translations
  = en` keeps the helper callable from non-React modules while making the
  live catalog the intended argument; the default is the honest fallback,
  not the design.
- **The record does not depend on the send.** This is the shape every
  door in the subject should have: the durable in-app trace is
  unconditional, the external attempt is best-effort.

## Gaps against the technique (reported, not fixed)

- **The measured 52-of-57.** Five delivery doors for one concept
  (`crate::notifications::send` ×31 sites, `sendAppNotification` ×16, a
  raw Web-`Notification` wrapper ×6 with three silent returns and no
  capability, bare plugin `sendNotification` ×2, the two good helpers ×2);
  52 sites compose hardcoded English; the 31 Rust sites are literals or
  English-skeleton `format!` templates on the side of the boundary that
  holds no locale — the technique's exact "unfixable in place" case. The
  translation gate (`i18n-no-gaps`, 19,112 keys × 13 locales at 0
  missing) never sees any of them
  ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **The good door has one caller.** `notifyProcessComplete` is invoked
  from a single site (`teams/sub_assignments/useAssignmentNotificationDispatcher.ts`)
  with two of its 14 declared process types. A door with optional
  attendance is a lobby; nothing (lint wall, module privacy) makes the
  four sibling doors unreachable.
- **No fact/message split across the boundary.** Rust sites compose
  prose and hand it to `send`; the technique wants the backend to emit
  the fact (type + coordinates + payload) and the locale layer to compose
  — or, where the backend must notify with no UI running, to read a
  persisted locale and treat its small string set as a gated translation
  surface. Neither exists; the persisted-locale path is the cheaper
  retrofit for the 31.
- **The outbound webhook default summary is English by construction.**
  `providers::default_summary` (`webhook_notifier.rs:302-316`) formats
  `[Personas] <event_type> — <source>/<id>`. Defensible as a
  machine-readable one-liner (event types are identifiers, not prose),
  but the test-notification body ("Personas test notification",
  `:752`, `:757-760`) is prose, and no subscription carries a
  target-language field — the fixed-language-space decision the
  technique asks for is not recorded anywhere; it is implied.
- **Retrofit order applies.** Door count (5) is the leading metric;
  translating strings before collapsing doors would hardcode the catalog
  into five places.
