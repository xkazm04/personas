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
