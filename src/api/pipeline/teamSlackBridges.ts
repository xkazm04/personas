import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Team ↔ Slack bridges, resolved by the backend.
 *
 * A bridge is stored as a `ChannelSpecV2` entry inside a persona's
 * `notification_channels` (see `lib/channel/teamBridgeSpec.ts`), which means
 * the frontend CANNOT derive it from the roster: `list_personas` is a lean
 * projection that returns `notification_channels` blank. `list_team_slack_bridges`
 * is the backend's own scan over `personas::get_enabled` — the same scan the
 * poller and the outbound relay run — so what the UI shows is what the engine
 * will actually act on.
 */

/**
 * One resolved bridge. Mirrors the Rust `TeamSlackBridgeInfo` (camelCase on the
 * wire). Declared locally rather than imported from `@/lib/bindings/` because
 * the ts-rs binding is emitted by `cargo test export_bindings`, which the
 * backend side of this feature owns; swap this for
 * `@/lib/bindings/TeamSlackBridgeInfo` once that file is committed.
 */
export interface TeamSlackBridgeSummary {
  teamId: string;
  personaId: string;
  slackChannelId: string;
  credentialId: string;
  pollInbound: boolean;
  outboundMessages: boolean;
  outboundDirectives: boolean;
  outboundSteps: boolean;
}

/** Every configured bridge across every enabled persona. */
export const listTeamSlackBridges = () =>
  invoke<TeamSlackBridgeSummary[]>('list_team_slack_bridges');

/**
 * Same, but never throws. Bridges are decoration on surfaces whose primary job
 * is something else (the Monitor's conversation list), so a backend that does
 * not expose the command yet, or an IPC hiccup, must degrade to "no bridges"
 * rather than blank the surface.
 */
export async function listTeamSlackBridgesSafe(): Promise<TeamSlackBridgeSummary[]> {
  try {
    return await listTeamSlackBridges();
  } catch (err) {
    silentCatch('api/pipeline/teamSlackBridges:list')(err);
    return [];
  }
}
