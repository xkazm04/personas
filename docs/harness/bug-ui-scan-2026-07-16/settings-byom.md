# Settings & BYOM — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. System API key mint/revoke TOCTOU race can leave the whole app holding a revoked key
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/management_api.rs:526-567
- **Scenario**: Two callers hit `get_or_create_system_api_key` concurrently at startup (e.g. the frontend's `get_system_api_key` Tauri command and the MCP sidecar bridge). Caller A passes the empty-cache check, mints key K_A, takes the lock and caches K_A. Caller B — which also passed the cache check before A cached — then runs the revoke sweep (lines 537-541, executed **outside the lock**), sees K_A as an enabled key named `system`, and revokes it. B mints K_B, takes the lock, finds K_A already cached, and per the "prefer their value" branch (line 562-564) returns K_A — which B just revoked.
- **Root cause**: The check-cache / revoke-old-keys / create-new-key / populate-cache sequence is not atomic; only the two cache touches are under the mutex. The sweep can revoke a key another thread minted and cached microseconds earlier.
- **Impact**: Both callers now hold a revoked token; every management-API fetch (proxy bridge, direct HTTP fetches from the desktop frontend) returns 401 for the remainder of the process lifetime — no self-healing, needs an app restart. Bonus: K_B stays behind as an enabled, never-expiring orphan key with broad scopes (`personas:execute`, `proxy`), invisible in the UI (name `system` is hidden).
- **Fix sketch**: Hold the mutex across the entire sweep+create+cache sequence (the fast path can still return early under the same lock), or re-check the cache after the sweep and before create. Also revoke K_B (own freshly-minted key) when losing the race.

## 2. "Origin-bound" paired keys are only enforced by CORS — never checked at authentication
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/management_api.rs:377-457
- **Scenario**: A user pairs a cloud app; `approve_pairing` mints a key with `bound_origin = https://app.example`. The key plaintext later leaks from that cloud app (logged request, compromised frontend, XSS). An attacker replays it from `curl`, a script, or any non-browser client.
- **Root cause**: `bound_origin` is consumed solely to build the `PAIRED_ORIGINS` CORS allowlist (lines 184-230). `require_api_key` captures the request `Origin` header only to write it into the audit row; it never compares it against the matched key's `bound_origin`. CORS is browser-advisory — non-browser clients send no `Origin` and bypass it entirely.
- **Impact**: The origin-binding the pairing ceremony promises ("this key only works from the origin you approved") is not enforced server-side. A leaked paired key grants its full scope set (which can include `personas:execute:persona:<id>` — real execution) to any client until expiry/revocation. The UI's "Connected apps" section reinforces the false containment guarantee.
- **Fix sketch**: In `require_api_key`, after `find_by_token`, reject with 403 when `key.bound_origin` is `Some(o)` and the request's `Origin` header is absent or differs from `o`. Keep the CORS layer as defense-in-depth.

## 3. byom.rs unit tests pin the pre-2026-07-15 validate() behavior and now fail
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/byom.rs:863-918, 1343-1363
- **Scenario**: Run `cargo test` in `src-tauri`. `test_validate_compliance_rule_outside_allowed` asserts an Error whose message contains "never match"; `test_validate_compliance_rule_blocked_provider` asserts two Errors including "never match"; `test_validate_routing_rule_critical_is_inert_warning` asserts a "never fires" Warning. `validate()` no longer emits any of these — the inert-compliance rule was downgraded to a partial-coverage Warning (lines 386-397) and the inert-routing warning was removed outright (comment at lines 436-440, and lines 921-944 assert the *new* behavior for the same shape of policy).
- **Root cause**: The 2026-07-15 change wiring `TaskComplexity::infer` and `template_category` updated `validate()` and *some* tests (e.g. `test_validate_routing_rule_outside_allowed`) but left three older tests asserting the removed messages/severities — code and its pinning tests drifted apart in the same file.
- **Impact**: A permanently red slice of the Rust suite. Real regressions in the BYOM policy engine (the security-relevant fail-open/fail-closed matrix) can hide behind "those tests always fail"; CI signal for this module is dead.
- **Fix sketch**: Update the three stale tests to assert current behavior (partial-coverage Warning for tagged compliance rules; no inert-routing warning; adjusted counts), mirroring the already-updated neighbors at lines 921-1010.

## 4. Idle-kept inactive settings tabs remain keyboard-focusable while invisible
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/settings/components/SettingsPage.tsx:74-87
- **Scenario**: User opens Settings → API Keys, then switches to BYOM. For the next 30 s (IDLE_UNMOUNT_MS) the API Keys tab stays mounted, styled `absolute inset-0 pointer-events-none` with `opacity: 0`. The user presses Tab repeatedly (or uses a screen reader): focus lands on the invisible tab's buttons — including the destructive two-click Delete button on an API key row, which plain Enter can activate (pointer-events does not block keyboard activation).
- **Root cause**: The keep-mounted optimization hides inactive tabs visually (opacity) and for the pointer (pointer-events) but not for the accessibility tree or the tab order — no `inert`, `aria-hidden`, `visibility: hidden`, or `display: none`.
- **Impact**: Keyboard focus disappears into an invisible layer (focus ring vanishes, users get "lost"); screen readers announce content from a tab the user left; worst case an Enter keypress interacts with invisible destructive controls on another settings tab.
- **Fix sketch**: Add `inert` (and `aria-hidden`) to the inactive wrapper, or animate to `visibility: hidden` on exit (framer-motion `transitionEnd: { visibility: 'hidden' }`). Either removes hidden tabs from focus order while preserving the mount cache.

## 5. Revoked paired-app keys vanish from both API-key lists and become undeletable ghosts
- **Severity**: Low
- **Category**: ui
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:146-148
- **Scenario**: User pairs a cloud app (key with `bound_origin`), then clicks Disconnect in "Connected apps". `revoke_pairing` flips `revoked_at`; on reload the row matches neither list: `regularKeys` requires `!k.bound_origin` (it has one) and `pairedKeys` requires `!k.revoked_at` (it is revoked).
- **Root cause**: The two filters partition on different fields and their union is not the full set — revoked+origin-bound rows fall through the partition.
- **Impact**: The revoked pairing silently disappears (Disconnect looks like Delete, contradicting the revoke-keeps-audit-trail model shown for regular keys), its audit drawer becomes unreachable, and the row can never be deleted from the UI — permanent DB residue only removable via raw SQL.
- **Fix sketch**: Show revoked paired keys either greyed-out in "Connected apps" (like revoked regular keys, with Delete + Audit actions) or fold them into the regular list; ensure the two filters partition the full key set.
