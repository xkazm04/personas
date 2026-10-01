/**
 * L3 Voice: every channel the twin speaks on, in full (spark
 * twin-portable-blueprint): where the voice came from, the written directives,
 * the length hint, the stored writing samples and do/don't rules, and the
 * style dimensions as the shared pips. The channel the blueprint was pressed
 * on comes first.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KeyValueGrid, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinTone } from '@/lib/bindings/TwinTone';

import { channelName } from '../../experience/channels';
import { DimensionChips } from '../../setup/style/DimensionChips';
import type { BlueprintChannel, VoiceOrigin } from '../blueprintContract';
import { itemFirst, storedItems, type SectionDetailProps } from './detailParts';

function ItemList({ label, items, testId }: { label: string; items: string[]; testId: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <p className="typo-label text-foreground">{label}</p>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="typo-body text-foreground whitespace-pre-wrap break-words border-l-2 border-primary/20 pl-3">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChannelDetail({ channel, tone }: { channel: BlueprintChannel; tone: TwinTone | undefined }) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const origins: Record<VoiceOrigin, string> = {
    preset: m.originPreset,
    rolled: m.originRolled,
    learned: m.originLearned,
    manual: m.originManual,
  };
  const directives = tone?.voice_directives.trim() || null;
  const examples = storedItems(tone?.examples_json);
  const rules = storedItems(tone?.constraints_json);

  return (
    <Section
      level={2}
      title={channelName(channel.channel, t.twin.experience.sheet.everywhere)}
      meta={channel.origin ? origins[channel.origin] : m.noStyle}
    >
      <div className="flex flex-col gap-4" data-testid={`twin-detail-voice-${channel.channel}`}>
        <KeyValueGrid
          items={[
            { k: m.samples, v: <Numeric value={channel.exemplars} /> },
            { k: m.rules, v: <Numeric value={channel.rules} /> },
            { k: t.twin.detail.lengthHint, v: tone?.length_hint?.trim() || null, none: t.common.none },
          ]}
        />
        <div className="flex flex-col gap-1">
          <p className="typo-label text-foreground">{m.directives}</p>
          <p className={directives ? 'typo-body text-foreground whitespace-pre-wrap break-words' : 'typo-caption'}>
            {directives ?? t.twin.detail.noDirectives}
          </p>
        </div>
        {examples.length > 0 && <ItemList label={m.samples} items={examples} testId={`twin-detail-samples-${channel.channel}`} />}
        {rules.length > 0 && <ItemList label={m.rules} items={rules} testId={`twin-detail-rules-${channel.channel}`} />}
        {channel.dims && (
          <div className="flex flex-col gap-2">
            <p className="typo-label text-foreground">{m.style}</p>
            <DimensionChips dims={channel.dims} dense />
          </div>
        )}
      </div>
    </Section>
  );
}

export function VoiceDetail({ model, sources, itemKey }: SectionDetailProps) {
  const channels = itemFirst(model.voice.channels, (c) => c.channel === itemKey);
  return (
    <div className="flex flex-col gap-6" data-testid="twin-detail-voice">
      {channels.map((c) => (
        <ChannelDetail key={c.channel} channel={c} tone={sources.tones.find((tone) => tone.channel === c.channel)} />
      ))}
    </div>
  );
}

export default VoiceDetail;
