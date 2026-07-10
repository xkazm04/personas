> Context: teams (misc)
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. Concurrent capability "reaping" of the same deliberation action
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/teams/sub_deliberations/useTeamDeliberations.ts:106-117, 184-211
- **Scenario**: User clicks "Approve & run". `approveAction` enters a for-loop that calls `pollDeliberationAction(id)` every 2s (up to 600×). Its `refreshDetail` sets `detail.status = 'action_running'`, which makes the polling `useEffect` (line 107-108, `running = detail.status === 'action_running'`) ALSO start calling `pollDeliberationAction(selectedId)` every 6s. Two independent reap loops now hit the same deliberation concurrently.
- **Root cause**: Two separate control paths (the imperative approve loop and the declarative status-poll effect) both own "advance the action_running deliberation", with no shared guard (`actionBusy` isn't consulted by the effect).
- **Impact**: Depending on backend idempotency of `poll_deliberation_action` (posts output + resumes), duplicate resume/advance can double-post output or race the recovery `advance`. At minimum it doubles command traffic for ~20 min while `actionBusy` stays true.
- **Fix sketch**: Have the poll effect skip when `actionBusy` (or `running`) is set: `if (running && !actionBusy) void pollDeliberationAction(...)`. Or drop the in-loop poll and let the effect be the single reaper.

## 2. Red Room silently drops team events older than the 500 newest global events
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/teams/sub_redRoom/useRedRoomFeed.ts:158-193
- **Scenario**: `refresh` calls `listEvents(EVENT_LIMIT=500)` UNSCOPED (all teams/personas), then filters client-side to this team's members/project. On a busy install where another team emitted >500 events since this team's last activity, this team's real transmissions fall outside the 500-row window and never appear — the transcript shows "No transmissions" or a truncated history with no indication anything was cut.
- **Root cause**: Global recent-N fetch + client filter, chosen because project-scoped queries "proved too narrow", trades one narrowness (missing project_id) for another (global recency cap).
- **Impact**: UX / data-visibility — the room misrepresents a team as quiet when it isn't; no "history truncated" affordance.
- **Fix sketch**: Add a member/team-scoped events query (source_id/target IN members OR project_id) server-side, or raise/keyset-paginate the limit; failing that, surface a "showing recent N" notice when the raw fetch hits EVENT_LIMIT.

## 3. Notification dedupe key is set before the await, so a fetch failure permanently suppresses the alert
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/teams/sub_assignments/useAssignmentNotificationDispatcher.ts:37-68
- **Scenario**: On `awaiting_review`, the code does `notifiedRef.current.add(assignment_id)` (line 38) BEFORE `await getTeamAssignmentDetail` (line 41). If that fetch throws (transient IPC/db error), the catch swallows it — but the id is already marked notified. No further `awaiting_review` event for that assignment will re-attempt, because the key is only cleared when the status LEAVES `awaiting_review` (line 33), which may never happen for a stuck review.
- **Root cause**: Optimistic dedupe-marking before the side effect that can fail.
- **Impact**: A user misses the desktop notification for a genuinely stuck review; the panel still shows it, so non-fatal but defeats the feature's purpose.
- **Fix sketch**: Move `notifiedRef.add` to after a successful `notifyProcessComplete`, or remove the id from the set inside the catch so a subsequent duplicate event retries.

## 4. Unvalidated casts of persona-authored JSON into typed shapes
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: trust-boundary
- **File**: src/features/teams/sub_collab/useTeamChannel.ts:40-49; src/features/teams/sub_deliberations/DeliberationsPane.tsx:53-65, 138-145
- **Scenario**: `parseDeliveries` casts `root.deliveries` to `DirectiveDelivery[]` after only an `Array.isArray` check; `parseResolution`/`pendingAction` cast parsed JSON to `ProposalSpec`/`PendingAction` with only a top-level `typeof` on a couple of fields. Payloads originate from persona/agent-emitted JSON. A malformed entry (e.g. a delivery element missing `persona_id`) flows straight into `PersonaChip persona={personaIndex.get(d.persona_id)}` (undefined key) and into rendered `pendingAction.personaName`/`useCaseTitle`.
- **Root cause**: `JSON.parse` result trusted structurally at a data trust boundary.
- **Impact**: Mostly benign (undefined → empty chip / blank name), but any assumption that array elements are objects could throw if an element is a scalar.
- **Fix sketch**: Filter `deliveries` to elements that are objects with string `persona_id`; guard `pendingAction` fields with `typeof` before render (or a tiny schema check).

## 5. Three separate payload extractors for the same channel/event JSON
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/teams/sub_collab/payloadView.ts:1-139 vs src/features/teams/sub_redRoom/useRedRoomFeed.ts:85-135
- **Scenario**: `payloadView.humanizePayload`/`payloadSummary` (used by Collab row + ChannelDetailModal) and `useRedRoomFeed.parsePayload` both decode arbitrary agent JSON into `{summary/primary, artifact}`. They carry near-identical PRIMARY key lists and IDENTICAL `URL_KEYS`, and `looksOpaque` is byte-for-byte duplicated in both files (payloadView.ts:42-45 and useRedRoomFeed.ts:120-123), as are `firstString`/`pickString` and `shortUrl`. payloadView.ts's own header even calls out that the *old* two-place extractor caused inconsistent rendering — Red Room is the third place.
- **Root cause**: Red Room predates payloadView's consolidation and was never migrated onto it.
- **Impact**: maintainability — a key added to one list (e.g. `verdict`, `note`, `content` exist only in payloadView) silently doesn't apply in Red Room; two `looksOpaque`/`shortUrl` copies drift.
- **Fix sketch**: Point `useRedRoomFeed.parsePayload` at `payloadSummary` from payloadView and delete the local `parsePayload`/`firstString`/`looksOpaque`/`shortUrl`.

## 6. `FAMILY_TEXT` color map triplicated and already divergent
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_collab/collabRender.tsx:54-62; src/features/teams/sub_redRoom/RedRoomTranscript.tsx:32-41; src/features/teams/sub_redRoom/RedRoomDetailModal.tsx:27-35
- **Scenario**: Three copies of the event-family→text-color map. They have already diverged: collabRender maps `pr` to `text-status-info` and `qa` to `text-status-warning` (design tokens), while both Red Room copies hardcode `text-blue-300` / `text-amber-300`. RedRoomTranscript's copy additionally adds a `note` key the others lack.
- **Root cause**: Copy-paste per surface instead of a shared constant next to `eventFamily`.
- **Impact**: maintainability / visual inconsistency — the same event family renders a different hue in Collab vs Red Room.
- **Fix sketch**: Export one `FAMILY_TEXT` (and `FAMILY_RAIL`) from `useRedRoomFeed.ts` (where `eventFamily` lives) and import it in all three; reconcile token-vs-hardcoded choice once.

## 7. Dead export: `dayKey` in collabRender.tsx
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/teams/sub_collab/collabRender.tsx:119-123
- **Scenario**: `export function dayKey(at: string)` has no importers. `CollabLiveCorrespondence` computes day separators with its own local `daySeparatorLabel`/`sameLocalDay` (CollabLiveCorrespondence.tsx:44-85), never `dayKey`. The only other `dayKey` in the codebase is an unrelated `(d: Date)` in `features/schedules/libs/calendarHelpers.ts`. Verified via repo-wide grep — no import of this symbol.
- **Root cause**: Leftover from a retired "chapter divider" variant (the file comment references baseline + C5 variants that were consolidated).
- **Impact**: maintainability — dead surface.
- **Fix sketch**: Delete the function.

## 8. `useRedRoomFeed` returns `refresh`, `refreshSubscriptions`, and `memories` that no caller uses
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/teams/sub_redRoom/useRedRoomFeed.ts:300
- **Scenario**: The hook's only consumer, `RedRoomPane`, destructures just `{ items, loaded, projectId }` (RedRoomPane.tsx:22). The returned `memories`, `refresh`, and `refreshSubscriptions` are never read anywhere (grep shows `refreshSubscriptions` only self-referenced inside the hook; `memories` matches are all unrelated slices/props).
- **Root cause**: Return object carries internals that were once (or were anticipated to be) driven externally.
- **Impact**: maintainability — over-broad API implies external refresh hooks that don't exist.
- **Fix sketch**: Trim the return to `{ items, loaded, projectId }` (keep internal callbacks internal), or wire an actual manual-refresh affordance if intended.
