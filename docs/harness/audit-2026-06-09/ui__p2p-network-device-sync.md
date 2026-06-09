# UI Perfectionist — p2p-network-device-sync
> Total: 6
> Severity: 0 critical, 3 high, 3 medium, 0 low

## 1. Peer connection status is encoded by dot color only — invisible to screen readers and colorblind users
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/settings/sub_network/components/PeerCard.tsx:18-23,59
- **Scenario**: In the discovered-peers list, each row leads with a 2.5px colored dot — emerald (Connected), amber-pulse (Connecting), red (Failed), zinc (Disconnected). A colorblind user cannot distinguish connected from failed; a screen-reader user gets nothing — the `<span>` has no text, `aria-label`, or `role`.
- **Root cause**: `STATE_DOT` maps state → background color only, and the dot span carries no accessible name. The PeerCard is the primary at-a-glance view, yet the only labeled connection indicator (a text pill) lives in PeerDetailDrawer.tsx:180-187, which requires opening the drawer.
- **Impact**: inaccessible | error-blind
- **Fix sketch**: Add a non-color channel to the dot: give it `role="img"` with `aria-label={st[stateKey]}` (e.g. "Connected"), and pair the dot with a tiny state shape/icon or a `sr-only` text label. Reuse the same labeled-pill component from the drawer (see finding 2) so the status reads identically in list and detail.

## 2. Trust-badge and connection-status markup is reimplemented 3–4 times with no shared component
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/settings/sub_network/components/PeerCard.tsx:70-74
- **Scenario**: The verified/unknown trust icon + color is hand-written in PeerCard (70-74), again in PeerDetailDrawer.tsx:158-162, and a third variant (icon + text pill, with revoked handling) in IdentitySettings.tsx:218-239. The connection-state pill is separately hand-rolled in PeerDetailDrawer.tsx:180-187 and as a colored dot in PeerCard.tsx:18-23.
- **Root cause**: No `<TrustBadge level=...>` or `<ConnectionStatus state=...>` primitive exists, so each call site re-derives icon, color, and label inline — guaranteeing drift (the IdentitySettings variant already diverges; see finding 3).
- **Impact**: inconsistency
- **Fix sketch**: Extract `TrustBadge` (maps `verified|unknown|manual|revoked` → icon + token + i18n label) and `ConnectionStatus` (maps `Connected|Connecting|Failed|Disconnected` → dot/pill + label) into NetworkIcons.tsx or a new `StatusBadges.tsx`. Replace all four call sites so trust and connection visuals are defined once.

## 3. Trust color language is inconsistent across the three trust surfaces
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/settings/sub_network/components/IdentitySettings.tsx:233-239
- **Scenario**: PeerCard and the drawer signal trust with `emerald-400` (verified) / `amber-400` (unknown). IdentitySettings instead renders a text pill using `green-500` for verified, `blue-500` for `manual`, and `red-500` for revoked. So "trusted" is emerald in one view but a different green elsewhere, and the `manual` trust level (blue) has no counterpart in the peer list at all.
- **Root cause**: Two unrelated color maps for the same trust taxonomy — `emerald/amber` icon tints vs an inline `green-500/blue-500/red-500` pill ternary — plus a green token mismatch (`emerald-400` vs `green-500`).
- **Impact**: inconsistency
- **Fix sketch**: Define one trust token table (verified→emerald, manual→blue, unknown→amber, revoked→red) inside the shared `TrustBadge` from finding 2 and consume it everywhere. Use the same icon + tint + label triple so a peer's trust reads identically in the card, the drawer, and the trusted-peers list.

## 4. Empty state always says "scanning" — no idle "no peers found" or error state after a scan completes
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/settings/sub_network/components/PeerList.tsx:148-231
- **Scenario**: When discovery finishes with zero peers, the list shows an animated radar plus "scanning network…" (line 224) indefinitely. The user can't tell whether discovery is still working or finished empty. A `networkError` is shown as a separate banner above (102-107) but the body still claims it's scanning, and there is no distinct "scan failed / network off" body state.
- **Root cause**: `RadarEmptyState` is reused for both the loading skeleton concept and the genuine empty result, hardcoding the active-scan copy regardless of whether a scan is in progress, idle-empty, or errored.
- **Impact**: confusion | error-blind
- **Fix sketch**: Split into three body states — scanning (skeleton), idle-empty ("No peers discovered on your LAN" + "Scan again" CTA + the existing `lan_hint`), and error (when `networkError` is set, show a retry-focused message instead of the radar). Keep the radar animation only while `loading` is true.

## 5. Action buttons rely on `title` only; rows lack list/status semantics for keyboard and screen readers
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/settings/sub_network/components/PeerCard.tsx:84-114
- **Scenario**: Connect, Disconnect, and View-details buttons expose intent only via `title` (84, 93, 99, 109), which is unreliable for screen readers and absent for keyboard-focus hints. The peer list `<div className="space-y-2">` (PeerList.tsx:114) and each animated row wrapper carry no `role="list"`/`role="listitem"`, so assistive tech reads it as undifferentiated text.
- **Root cause**: Icon-only buttons were given `title` instead of `aria-label`, and the list container uses generic divs rather than list semantics.
- **Impact**: inaccessible
- **Fix sketch**: Add `aria-label` (keep `title` for mouse hover) to the three icon buttons, mark the spinner state with `aria-busy`/`aria-label={st.connecting}`, and apply `role="list"` to the container with `role="listitem"` on each row in PeerList.tsx:114-130.

## 6. Hardcoded English breaks i18n consistency in the peer card and list
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/settings/sub_network/components/PeerCard.tsx:48-50
- **Scenario**: Relative last-seen text is hardcoded — "just now", `${n}m ago`, `${n}h ago` (48-50) — while every other label in this surface comes from `t.sharing`. PeerList.tsx:96 likewise hardcodes the word "scanned", and PeerDetailDrawer.tsx:258 hardcodes "synced". In a localized build these strings render in English amid translated UI.
- **Root cause**: Ad-hoc inline relative-time formatting and literal label strings instead of the shared `RelativeTime` component / `st.*` keys already used elsewhere in the same files.
- **Impact**: inconsistency
- **Fix sketch**: Replace the inline `lastSeen` calc with the existing `<RelativeTime timestamp={peer.last_seen_at} />` (already used in PeerDetailDrawer) and route the "scanned"/"synced" labels through `st.*` keys, matching the rest of the surface.
