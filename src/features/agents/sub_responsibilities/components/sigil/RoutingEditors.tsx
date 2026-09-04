import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { CONNECTOR_META } from '@/lib/connectors/connectorMeta';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { StringListEditor } from '../fields/StringListEditor';
import {
  mergeSpec,
  sameValue,
  eventSubscriptionNames,
  specWithEventSubscriptions,
} from '../../libs/charterSpec';
import { DimEditorShell, ChipToggleList, type CharterDimEditorProps } from './dimEditorShell';

/** Channel vocabulary the notification router understands. Mirrors the
 *  retired `CHANNEL_TYPES` constant the use-case channel dropdown carried. */
const CHANNELS = ['slack', 'telegram', 'email'] as const;

/**
 * `connector` — the charter's connector ALLOWLIST (`persona_responsibilities.
 * connectors`). An empty list means "whatever the persona holds"; a non-empty
 * one narrows the charter's runs to exactly those connectors.
 */
export function ConnectorDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const [selected, setSelected] = useState<string[]>(() => [...charter.connectors]);
  const [pending, setPending] = useState('');

  const options = useMemo(() => {
    const known = Object.entries(CONNECTOR_META).map(([value, meta]) => ({ value, label: meta.label }));
    // A charter can hold a slug the catalog does not know (custom MCP tool,
    // retired connector). Keep it selectable rather than silently dropping it.
    const extra = selected
      .filter((s) => !(s in CONNECTOR_META))
      .map((value) => ({ value, label: value }));
    return [...extra, ...known].sort((a, b) => a.label.localeCompare(b.label));
  }, [selected]);

  const toggle = (value: string) =>
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const dirty = !sameValue(selected, charter.connectors);

  return (
    <DimEditorShell
      caption={selected.length === 0 ? c.dim_connector_caption_open : c.dim_connector_caption}
      dirty={dirty}
      testId="resp-dim-connector"
      onSave={() => onPatch({ connectors: selected })}
    >
      <div className="max-h-56 overflow-y-auto scrollbar-thin pr-1">
        <ChipToggleList
          options={options}
          selected={selected}
          onToggle={toggle}
          testId="resp-dim-connector-chips"
        />
      </div>
      <input
        value={pending}
        onChange={(e) => setPending(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const slug = pending.trim();
          if (!slug || selected.includes(slug)) return;
          setSelected((prev) => [...prev, slug]);
          setPending('');
        }}
        placeholder={c.connector_custom_placeholder}
        className={INPUT_FIELD}
        data-testid="resp-dim-connector-custom"
      />
    </DimEditorShell>
  );
}

/** `message` — where the charter's runs report (`spec.notificationChannels`). */
export function MessageDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const saved = charter.spec.notificationChannels ?? [];
  const [selected, setSelected] = useState<string[]>(() => [...saved]);
  const dirty = !sameValue(selected, saved);
  const channelLabels: Record<(typeof CHANNELS)[number], string> = {
    slack: c.channel_slack,
    telegram: c.channel_telegram,
    email: c.channel_email,
  };

  return (
    <DimEditorShell
      caption={c.dim_message_caption}
      dirty={dirty}
      testId="resp-dim-message"
      onSave={() => onPatch({ spec: mergeSpec(charter.spec, { notificationChannels: selected }) })}
    >
      <ChipToggleList
        options={CHANNELS.map((value) => ({ value, label: channelLabels[value] }))}
        selected={selected}
        onToggle={(value) =>
          setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
        }
        testId="resp-dim-message-chips"
      />
    </DimEditorShell>
  );
}

/** `event` — the event types the charter subscribes to (`spec.eventSubscriptions`). */
export function EventDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const saved = useMemo(() => eventSubscriptionNames(charter.spec), [charter.spec]);
  const [names, setNames] = useState<string[]>(() => [...saved]);
  const dirty = !sameValue(names, saved);

  return (
    <DimEditorShell
      caption={c.dim_event_caption}
      dirty={dirty}
      testId="resp-dim-event"
      onSave={() => onPatch({ spec: specWithEventSubscriptions(charter.spec, names) })}
    >
      <div data-testid="resp-dim-event-list">
        <StringListEditor
          label={c.event_subscriptions_label}
          items={names}
          onChange={setNames}
          testId="resp-event"
        />
      </div>
    </DimEditorShell>
  );
}
