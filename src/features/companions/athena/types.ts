// Companion (Athena) — shared TypeScript types.
//
// Most companion types live alongside the API surface in @/api/companion
// (chat / brain / approval / proactive / connectors). This file keeps
// types that are purely UI-shape concerns and don't cross the IPC boundary.

/**
 * Companion presence state.
 *  - `closed`     — hidden entirely.
 *  - `collapsed`  — reachable from the footer, but neither orb nor panel shown.
 *  - `minimized`  — the floating dockable orb is visible (voice-first, no
 *                   transcript). New in the orb-overlay work (Step 2).
 *  - `open`       — the full chat panel is open.
 */
export type CompanionState = 'closed' | 'collapsed' | 'minimized' | 'open';
