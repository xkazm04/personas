---
layer: application
subject: device-pairing
technique: pairing-ceremony
stack: react
---

# The human gate: PairApprovalModal

`src/features/settings/sub_api_keys/components/PairApprovalModal.tsx` is
the mint gate's human half — mounted once at the app root, drawn entirely
by the desktop app, unreachable by the requesting origin.

## What the technique prescribes, line by line

- **Arm delay on the trust-granting control**:
  `APPROVE_ARM_DELAY_MS = 450` (`:24`); the approve button renders
  `disabled={!armed}` (`:190`) and arms via a timer that resets **per
  request** — the reset effect keys on the current nonce (`:55-64`), so
  request N+1 in the queue re-disarms rather than inheriting request N's
  armed state. Reject and "later" are instant (`:179-189`).
- **Scope narrowing**: requested scopes render as individually togglable
  rows (`toggleScope`, `:71-77`, list at `:128-147`); approval submits
  `[...scopes]` — the *narrowed* set — not `current.requested_scopes`
  (`:82`).
- **Bounded lifetime with a default**: expiry options 7/30/90 days,
  default 30, no "never" offered on this surface (`:25`, `:33`,
  `:150-171`).
- **Transport honesty**: a non-HTTPS origin gets an explicit warning row
  (`isHttps`, `:69`, rendered `:114-119`) — approvable, but never
  silently.
- **Full identity rendering**: both the claimed `app_name` and the
  channel-stamped origin render with `break-all` (`:110-113`) — a long
  look-alike origin cannot hide its tail behind an ellipsis.
- **Missed-signal safety net**: on mount the modal queries
  `listPendingPairings()` (`:41-45`) in addition to subscribing to the
  `pairing-requested` event (`:52`), so a request that arrived before the
  modal host existed still gets asked. The enqueue dedupes by nonce
  (`:47-51`) — the frontend half of resolution stability.

## The queue is per-request, not per-batch

Multiple pending pairings queue and present one at a time (`queue[0]`,
`:37`); each dequeue re-runs the reset effect, so every request gets its
own disarm window, its own default scope set, and its own expiry default.
Approving one request can never splash onto the next.

## Contrast inside the same repo

The sibling ceremony surface for P2P device pairing —
`IncomingPairingPanel` (see
`docs/concepts/golden-path-deferred-fixes.md` §36) — renders its
human-comparable code next to an **unarmed** primary button labeled
"Codes match, pair", while *unpairing* sits behind a two-step confirm:
the exact friction inversion the technique warns about, in the same
codebase that got it right here. The 450 ms arm exists in exactly two
places (`PairApprovalModal`, `RemoteApprovalPrompt`) and both guard
*cloud* approvals; neither guards the ceremony that permanently admits a
machine to the device group.
