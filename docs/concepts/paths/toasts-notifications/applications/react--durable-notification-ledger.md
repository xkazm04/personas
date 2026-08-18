---
layer: application
subject: toasts-notifications
technique: durable-notification-ledger
stack: react
---

# Durable notification ledger — React notification center (Personas)

The technique's durable-record tier as implemented by the notification-center
store, its drawer UI, and the sidebar badge — and the structural gap between
this ledger and the toast tier it should back.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| The store | `src/stores/notificationCenterStore.ts` — Zustand store persisted to `localStorage` under `pipeline_notification_history`, capped at `MAX_NOTIFICATIONS = 50` |
| One commit door | every mutation funnels through `commit()` (`notificationCenterStore.ts:119-122`), which persists **and** recomputes state in one place — add/markRead/markAllRead/dismiss/clearAll are all one-line wrappers around it |
| Badge count derived, never incremented | `countUnread()` (`:78-80`) carries its own doctrine comment: *"Single derivation point for the unread badge count — never recompute this inline."* `unreadCount` is set only inside `commit()`, from the same array it summarizes — the derivation-names-recomputation law implemented in eleven lines |
| Read vs dismissed vs cleared | `read: boolean` per entry; `markRead` (single), `markAllRead`, `dismiss` (removes one), `clearAll` (empties). Unread renders as a tinted row + orange dot in the drawer |
| Entries carry their remedy | `NotificationCenter.tsx` — process entries parse a `section#tab` redirect from `webUrl` and deep-link on click: select persona + restore the exact chat session, open the specific execution's detail modal via `pendingExecutionFocus`, or land on the named plugin tab. Pipeline entries carry Retry (re-triggers the pipeline) and open-in-browser actions. The ledger is a slow path to the same doors, not a museum |
| Badge on stable navigation | `src/features/shared/chrome/sidebar/BadgeSlot.tsx` — priority-ranked single badge per nav slot with a `+N` suppressed count and a tooltip enumerating every active state; count variant clamps at `99+` |
| Escalation writes the ledger unconditionally | `src/lib/notifications/notifyProcessComplete.ts:53-74` — the OS send sits inside a `try`; the `addProcessNotification` call sits **outside** it, so a denied/failed OS layer never costs the durable record. `usePipelineNotifications.ts:121-128` does the same ("always, regardless of OS permission") |

## Judgment calls worth copying

- **The commit door makes drift impossible by construction.** Because
  `unreadCount` is only ever written next to `notifications` inside
  `commit()`, there is no code path where the badge and the list disagree —
  the alternative (increment on add, decrement on read) is the classic
  drifting-counter bug, pre-empted here structurally.
- **Admission is severity-blind but event-shaped.** Only completions of
  long-running, user-awaited work (pipelines, scans, builds, reviews, chat
  results — 14 declared process types) enter; copy-confirmations and
  micro-acks never do. This matches the technique's admission rule from the
  "user walked away" side.

## Gaps against the technique (deviations, reported not fixed)

- **The toast tier and the ledger are disjoint populations.** Toasts
  (`toastStore`) and ledger entries (`notificationCenterStore`) are fed by
  different producers and share no identity: no toast has a durable twin,
  and no ledger entry retracts a live toast. The technique's central
  invariant — every message that matters has a durable record, acting on
  either resolves both — holds only for the escalation-tier events that
  happen to route through `notifyProcessComplete`.
- **Opening the drawer marks everything read.** The drawer-header comment
  says so directly ("opening the bell already marks everything read"), which
  collapses *unseen* into *opened-the-tray* — a bulk read on open, before
  any entry was actually viewed.
- **No obligation class.** Entries are uniformly news; there is no
  resolution state distinct from read, so an action-required event (a manual
  review) ages and can be evicted by the 50-entry cap or `clearAll` like any
  success notice. The technique forbids time/cap expiry for unresolved
  obligations.
- **Retention is cap-only.** Newest-first slice to 50, no per-class ages, no
  read-first eviction — a burst of 50 pipeline results silently evicts
  everything older, unread included.
- **Coalescing is absent.** A failure storm appends one row per occurrence;
  the technique's one-fact-with-a-count shape (update occurrence count on
  the existing entry) is not implemented.
