// Companion (Athena) — shared TypeScript types.
//
// Most companion types live alongside the API surface in @/api/companion
// (chat / brain / approval / proactive / connectors). This file keeps
// types that are purely UI-shape concerns and don't cross the IPC boundary.

export type CompanionState = 'closed' | 'collapsed' | 'open';
