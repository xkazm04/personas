import { channelName } from '../../../experience/channels';
import { DEPLOYMENT_CHANNELS, TONE_CHANNELS } from '../../../shared/channels';

/**
 * A tone channel's name as its product writes it ("WhatsApp", "SMS") from the
 * shared channel metadata; `generic` is the caller's translated "everywhere";
 * an id the metadata does not know falls back to the experience's capitalised
 * form. (Could be shared: the experience's `channelName` capitalises only the
 * first letter, so it writes "Whatsapp" and "Sms".)
 */
export function channelLabel(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  const meta = TONE_CHANNELS.find((c) => c.id === channel) ?? DEPLOYMENT_CHANNELS.find((c) => c.id === channel);
  return meta?.label ?? channelName(channel, everywhere);
}
