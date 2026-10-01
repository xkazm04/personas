/**
 * The Voice section of the blueprint: one entry per channel the twin has a
 * voice for or is bound to, `generic` first (spark twin-portable-blueprint).
 */
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import { safeJsonParse } from '@/lib/utils/parseJson';

import { countItems } from '../experience/channels';
import { parseToneStyle, STYLE_DIMENSIONS } from '../setup/style/styleContract';
import type { BlueprintChannel, VoiceOrigin } from './blueprintContract';

interface StoredStyle {
  source: Exclude<VoiceOrigin, 'manual'>;
  dims: TwinStyleDims;
}

/**
 * A `learned` style (written by the learn-from-sample accept door, WP3). The
 * shared `parseToneStyle` guard admits only `preset` and `rolled`, so without
 * this a learned channel would read as hand-written.
 */
function isLearnedStyle(value: unknown): value is { source: 'learned'; dims: TwinStyleDims } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const dims = v.dims as Record<string, unknown> | null | undefined;
  return v.source === 'learned' && !!dims && typeof dims === 'object' && STYLE_DIMENSIONS.every((d) => typeof dims[d] === 'number');
}

/** The style a tone row stores, or null for a hand-written row. */
export function storedStyleOf(styleJson: string | null): StoredStyle | null {
  const style = parseToneStyle(styleJson);
  if (style) return { source: style.source === 'rolled' ? 'rolled' : 'preset', dims: style.dims };
  const [learned] = safeJsonParse(styleJson, isLearnedStyle);
  return learned ? { source: 'learned', dims: learned.dims } : null;
}

function channelOf(channel: string, tone: TwinTone | undefined): BlueprintChannel {
  if (!tone) return { channel, exemplars: 0, rules: 0, hasDirectives: false, dims: null, origin: null };
  const style = storedStyleOf(tone.style_json);
  return {
    channel,
    exemplars: countItems(tone.examples_json ?? undefined),
    rules: countItems(tone.constraints_json ?? undefined),
    hasDirectives: tone.voice_directives.trim().length > 0,
    dims: style?.dims ?? null,
    origin: style?.source ?? 'manual',
  };
}

/**
 * `generic` (always: it is the fallback register every draft uses), then every
 * other channel with a tone row or a binding, alphabetically, so the order
 * does not depend on which list a fetch returned first.
 */
export function voiceChannelsOf(tones: readonly TwinTone[], channels: readonly TwinChannel[]): BlueprintChannel[] {
  const others = new Set<string>();
  for (const tone of tones) if (tone.channel !== 'generic') others.add(tone.channel);
  for (const bound of channels) if (bound.channel_type !== 'generic') others.add(bound.channel_type);
  const ids = ['generic', ...[...others].sort()];
  return ids.map((id) => channelOf(id, tones.find((t) => t.channel === id)));
}
