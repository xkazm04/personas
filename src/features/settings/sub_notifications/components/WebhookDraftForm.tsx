import { useTranslation } from '@/i18n/useTranslation';
import type { EventVocabularyEntry } from '@/lib/bindings/EventVocabularyEntry';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { parseEventTypes, type WebhookDraft, type WebhookProvider } from '../libs/webhookMatch';
import { WebhookEventPicker } from './WebhookEventPicker';

const PROVIDERS: readonly WebhookProvider[] = ['slack', 'discord', 'teams', 'generic'];

export const isWebhookProvider = (value: string): value is WebhookProvider =>
  (PROVIDERS as readonly string[]).includes(value);

const INPUT = 'mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground';

interface WebhookDraftFormProps {
  draft: WebhookDraft;
  onChange: (next: WebhookDraft) => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  vocabulary: EventVocabularyEntry[] | null;
}

export function WebhookDraftForm({ draft, onChange, onCancel, onSave, vocabulary }: WebhookDraftFormProps) {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  const valid =
    draft.label.trim().length > 0 &&
    draft.webhookUrl.trim().length > 0 &&
    parseEventTypes(draft.eventTypes).length > 0;

  return (
    <div className="px-4 py-4 space-y-3 bg-primary/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="typo-caption text-foreground">{s.webhook_subscriptions_label}</span>
          <input
            type="text"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            className={INPUT}
            placeholder={s.webhook_subscriptions_label_placeholder}
            data-testid="webhook-draft-label"
          />
        </label>
        <label className="block">
          <span className="typo-caption text-foreground">{s.webhook_subscriptions_provider}</span>
          <select
            value={draft.provider}
            onChange={(e) => {
              if (isWebhookProvider(e.target.value)) onChange({ ...draft, provider: e.target.value });
            }}
            className={INPUT}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {s.webhook_subscriptions_provider_labels[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="typo-caption text-foreground">{s.webhook_subscriptions_url}</span>
        <input
          type="text"
          value={draft.webhookUrl}
          onChange={(e) => onChange({ ...draft, webhookUrl: e.target.value })}
          className={`${INPUT} font-mono`}
          placeholder={s.webhook_subscriptions_url_placeholder}
          data-testid="webhook-draft-url"
        />
      </label>
      <div>
        <span className="typo-caption text-foreground">{s.webhook_subscriptions_events}</span>
        <WebhookEventPicker
          value={draft.eventTypes}
          onChange={(eventTypes) => onChange({ ...draft, eventTypes })}
          vocabulary={vocabulary}
        />
      </div>
      <label className="block">
        <span className="typo-caption text-foreground">{s.webhook_subscriptions_template}</span>
        <textarea
          value={draft.templateBody}
          onChange={(e) => onChange({ ...draft, templateBody: e.target.value })}
          rows={3}
          className={`${INPUT} font-mono`}
          placeholder={s.webhook_subscriptions_template_placeholder}
        />
        <span className="typo-caption text-foreground mt-1 block">{s.webhook_subscriptions_template_hint}</span>
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-interactive px-3 py-1 typo-caption text-foreground hover:bg-primary/10"
        >
          {s.webhook_subscriptions_cancel}
        </button>
        <AsyncButton
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={!valid}
          data-testid="webhook-draft-save"
        >
          {s.webhook_subscriptions_save}
        </AsyncButton>
      </div>
    </div>
  );
}
