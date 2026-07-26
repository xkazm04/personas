import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { ChannelSpecV2 } from '@/lib/bindings/ChannelSpecV2';
import type { TestDeliveryResult } from '@/lib/bindings/TestDeliveryResult';

/**
 * Test end-to-end delivery for shape-v2 channels. Each channel is rate-limited
 * to 1 req/sec server-side; rate-limited channels return
 * `{success: false, rateLimited: true, error: "rate_limited"}` without failing
 * the call. Built-in channels synthesize a real inbox message; titlebar channels
 * emit a real `titlebar-notification` event so the bell round-trips. External
 * channels (slack/telegram/email) delegate to the production delivery helpers.
 *
 * @see src-tauri/src/notifications.rs::test_channel_delivery
 */
export async function testChannelDelivery(
  channelSpecs: ChannelSpecV2[],
  sampleTitle: string,
  sampleBody: string,
): Promise<TestDeliveryResult[]> {
  return invokeWithTimeout<TestDeliveryResult[]>('test_channel_delivery', {
    channelSpecs,
    sampleTitle,
    sampleBody,
  });
}

/**
 * Shape-v1 external channel — the JSON `test_notification_channel` deserializes
 * into `notifications::ExternalChannel`. Field names are the WIRE names, so
 * `type` (not `channelType`) and `credential_id` (not `credentialId`); the Rust
 * struct uses `#[serde(rename = "type")]` and no `rename_all`.
 */
export interface ExternalChannelSpec {
  type: string;
  enabled: boolean;
  config: Record<string, string>;
  credential_id?: string;
}

/**
 * Send a fixed test notification through one shape-v1 external channel
 * (slack / telegram / email / …). Resolves with a human-readable delivery note;
 * REJECTS with the provider error string on failure — unlike
 * {@link testChannelDelivery}, which reports per-channel failure in its result.
 *
 * The command takes the channel as a JSON *string*, so this wrapper owns the
 * serialization: callers pass the object and can't get the wire field names
 * wrong.
 */
export async function testNotificationChannel(
  channel: ExternalChannelSpec,
): Promise<string> {
  return invokeWithTimeout<string>('test_notification_channel', {
    channelJson: JSON.stringify(channel),
  });
}
