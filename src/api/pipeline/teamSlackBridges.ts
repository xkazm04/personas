import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { TeamSlackBridgeInfo } from '@/lib/bindings/TeamSlackBridgeInfo';
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

// One resolved bridge is the ts-rs binding `TeamSlackBridgeInfo`. A local
// `TeamSlackBridgeSummary` copy stood here "until that file is committed"; it
// is, and nothing imported the copy's name.
export type { TeamSlackBridgeInfo };

/** Every configured bridge across every enabled persona. */
export const listTeamSlackBridges = () =>
  invoke<TeamSlackBridgeInfo[]>('list_team_slack_bridges');

/**
 * Same, but never throws. Bridges are decoration on surfaces whose primary job
 * is something else (the Monitor's conversation list), so a backend that does
 * not expose the command yet, or an IPC hiccup, must degrade to "no bridges"
 * rather than blank the surface.
 */
export async function listTeamSlackBridgesSafe(): Promise<TeamSlackBridgeInfo[]> {
  try {
    return await listTeamSlackBridges();
  } catch (err) {
    silentCatch('api/pipeline/teamSlackBridges:list')(err);
    return [];
  }
}
