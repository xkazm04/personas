  2. Execution Persistence — Analysis

  Good news: executions ARE persisted to SQLite. The persona_executions table stores all metadata, final output, tokens, cost,
  duration, tool steps, and error messages. Executions survive app restarts — stale running ones are auto-marked failed on startup
  via recover_stale_executions().

  The gap is streaming output only. The real-time execution-output events (the terminal-like line-by-line output) live only in
  Zustand's executionOutput[] array (capped at 5,000 lines). However, the runner already writes a log file to log_file_path on disk.

  For production long-term persistence, you already have it. What you may want to add:
  - Data retention policy — there's no auto-cleanup, so the table will grow indefinitely. Consider a configurable retention period
  (e.g., 90 days).
  - Expose log file reading — the log_file_path is stored in the DB. A Tauri command to read it back would let users review full
  streaming output of historical executions.
  - Pagination — fetchGlobalExecutions currently loads only last 10 per persona (50 total). For production, add backend-side
  pagination with cursor-based queries.

  3. Manual Review vs Messages — Analysis

  They are NOT redundant — they serve fundamentally different purposes:

  Aspect: Purpose
  Manual Review: Approval workflow (approve/reject)
  Message: Notification/communication
  ────────────────────────────────────────
  Aspect: Execution link
  Manual Review: Required (always tied to an execution)
  Message: Optional
  ────────────────────────────────────────
  Aspect: Lifecycle
  Manual Review: pending → approved/rejected → resolved
  Message: created → read
  ────────────────────────────────────────
  Aspect: Delivery
  Manual Review: In-app only
  Message: Multi-channel (email, Slack, Telegram, desktop) via PersonaMessageDelivery
  ────────────────────────────────────────
  Aspect: User action
  Manual Review: Requires decision (approve/reject with notes)
  Message: Passive (mark as read)

  They are created independently. When the Claude CLI emits a ManualReview protocol message, only a review record is created. When
  it emits SendMessage, only a message record is created. There is no automatic cross-creation.

  To evolve outside confusion:
  - Bridge pattern: When a ManualReview is created, optionally also emit a Message notification to configured channels (Slack,
  email) so reviewers are alerted outside the app. This would be a one-line addition in runner.rs after the review creation.
  - Unified activity feed: Consider a combined "Execution Artifacts" view that shows both reviews and messages for a given
  execution, filtered by type. This makes the relationship clear to users.
  - Naming clarity: In the UI sidebar, rename "Messages" to "Notifications" or "Outbound Messages" to distinguish from the review
  workflow.