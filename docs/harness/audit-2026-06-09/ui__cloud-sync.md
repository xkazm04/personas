# UI Perfectionist — cloud-sync
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Approval prompt cannot show which device requested the run
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:83-94
- **Scenario**: A run-request modal appears saying "Requested from the web dashboard". The user is approving execution of remote code locally but has no way to confirm which device/session originated it. If an attacker's session triggered the request, the prompt looks identical to a legitimate one.
- **Root cause**: The header only renders the static label `s.from_dashboard`. The `RemoteCommand` binding (src/lib/bindings/RemoteCommand.ts:6) carries no device/origin field at all — `{ id, personaId, personaName, commandType, prompt, requestedAt }` — so provenance is structurally absent from the data, not just the markup. For a security approval gate, "from which device" is the single most important context.
- **Impact**: inaccessible / error-blind (the user approves remote code execution blind to its origin — a genuine security-UX hole, not cosmetic)
- **Fix sketch**: Surface origin in the header where `from_dashboard` is rendered: device name, browser/OS, and approximate location/IP if available. This requires the backend `RemoteCommand` payload to include an `origin`/`requestedFrom` field; the frontend should render it as a distinct line under the persona identity (e.g. a small `MonitorSmartphone` chip mirroring CloudSyncCard's device chip at CloudSyncCard.tsx:201-208). Until the field exists, this finding documents the data+UI gap.

## 2. No expiry countdown — user can't tell if the request is stale or about to lapse
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:105-108
- **Scenario**: The prompt shows only a relative "requested 4 minutes ago" timestamp. A request that arrived while the app was closed (re-surfaced via `loadPending`, line 46-48) may be minutes or hours old. The user has no signal for whether approving still does anything, or how long they have to decide.
- **Root cause**: Only `RelativeTime` on `requestedAt` is rendered; there is no expiry/TTL field on `RemoteCommand` and no countdown affordance. The prompt frames this as a time-sensitive security decision but gives no deadline.
- **Impact**: confusion / error-blind (user may approve a long-expired request, or hesitate without knowing the window)
- **Fix sketch**: Add an `expiresAt` to the payload and render a countdown next to the timestamp (e.g. "expires in 2:48", turning amber under 30s and disabling Approve at 0 with an explanatory state). Reuse the amber `syncing` tone vocabulary from LiveStatusDot for the urgency color so it stays color-not-only (pair with text).

## 3. Reject is a destructive, irreversible action with no confirmation and the lightest visual weight
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:138-145
- **Scenario**: Reject permanently discards the request (`rejectRemoteCommand`, store line 53-62 removes it from the queue with no undo). It is styled as a low-weight `ghost` button with only red text, sitting between an equally-weighted "Decide later" ghost and a heavy primary "Approve & run". A user who misreads the three near-identical buttons can irreversibly reject a legitimate request in one click.
- **Root cause**: Three buttons share nearly the same visual weight; the one irreversible action (Reject) fires immediately with no confirm step, while the *reversible* deferral (Decide later) and the guarded Approve both get more affordance. The destructive action is the least protected.
- **Impact**: inaccessible / error-blind (one-click irreversible loss; weak visual hierarchy among three actions)
- **Fix sketch**: Either (a) require a confirm for Reject (inline two-step "Reject? · Confirm", matching the arm-delay philosophy already applied to Approve at line 19), or (b) make rejection recoverable. Visually, collapse to two primary choices (Approve / Reject) and demote "Decide later" to a quieter text-link, so the three actions stop competing at equal weight.

## 4. `commandType` is fetched but never shown — the body hardcodes "run"
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:111-113
- **Scenario**: The body always reads "Your dashboard requested a run of {persona} on this device." regardless of what was actually requested. The payload carries `commandType` (RemoteCommand.ts:6) but it is never rendered, so the user cannot distinguish what kind of action they are authorizing.
- **Root cause**: `current.commandType` is dropped; `s.body` interpolates only the persona name. The approval describes the action generically even though the data specifies it.
- **Impact**: confusion (the user approves without knowing the precise operation type)
- **Fix sketch**: Map `commandType` to a labeled chip near the persona identity (e.g. "Action: Run prompt"), or select the body string by command type. At minimum render the raw `commandType` as a caption so unknown types are visible rather than silently flattened to "run".

## 5. Approval prompt dialog has no description association for screen readers
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:74-81
- **Scenario**: A screen-reader user opening the prompt hears only the persona name (the `aria-labelledby` target at line 102). The critical safety framing ("This runs locally… Nothing runs until you approve.", line 130) and the prompt body are not announced as the dialog's description, so the user gets the title but not the stakes.
- **Root cause**: `BaseModal` sets `role="dialog"` + `aria-modal` + `aria-labelledby` (BaseModal.tsx:288-290) but exposes no `aria-describedby`, and the prompt provides no describedby id. The most security-relevant text is visually present but not programmatically tied to the dialog.
- **Impact**: inaccessible (SR users decide on remote code execution without the safety context)
- **Fix sketch**: Give the body paragraph (line 111) or safety note an `id` and thread an `aria-describedby` prop through `BaseModal` to the dialog element. This is a small, additive change that does not alter the visible UI.

## 6. Sync status chip shimmer placeholder is not announced; transient "Sync now" has no live region
- **Severity**: low
- **Category**: missing-state
- **File**: src/features/settings/sub_account/components/CloudSyncCard.tsx:120-127, 166-198
- **Scenario**: On first paint the status chip is an `aria-hidden` pulse placeholder (line 121), so screen-reader users hear nothing while status loads. When the user clicks "Sync now", the row text ("Synced 3s ago · 42 rows") updates silently — only a toast (line 95-97) announces completion, and the syncing state change itself is not in a live region.
- **Root cause**: The loading skeleton is `aria-hidden` with no "loading status" announcement, and the live result row (lines 177-197) is plain markup with no `aria-live`/`role="status"`. The visual layer handles all three states (synced/syncing/error) well and is correctly color-not-only via `LiveStatusDot` + `stateLabel`, but the non-visual layer lags.
- **Impact**: inaccessible (SR users miss load and sync-state transitions)
- **Fix sketch**: Add `role="status" aria-live="polite"` to the chip container (line 122-127) so state-label changes (Active/Syncing/Off) are announced, and give the skeleton an `aria-label` like "Loading sync status". No visual change required.
