import { useCallback, useEffect, useState } from 'react';
import { Webhook, Plus, Trash2, Send, CheckCircle2, XCircle, Pencil, AlertTriangle, CircleDashed } from 'lucide-react';
import { interpolate, useTranslation } from '@/i18n/useTranslation';
import {
  createNotificationSubscription,
  deleteNotificationSubscription,
  listNotificationSubscriptions,
  testNotificationSubscription,
  updateNotificationSubscription,
} from '@/api/events/notificationSubscriptions';
import { listKnownEventTypes } from '@/api/overview/events';
import type { NotificationSubscription } from '@/lib/bindings/NotificationSubscription';
import type { EventVocabularyEntry } from '@/lib/bindings/EventVocabularyEntry';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  EMPTY_WEBHOOK_DRAFT,
  classifyPatterns,
  deliveryHealth,
  draftToPayload,
  eventTypesToString,
  parseEventTypes,
  type WebhookDraft,
} from '../libs/webhookMatch';
import { WebhookDraftForm, isWebhookProvider } from './WebhookDraftForm';

export function WebhookSubscriptionsPanel() {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<WebhookDraft | null>(null);
  const [vocabulary, setVocabulary] = useState<EventVocabularyEntry[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await listNotificationSubscriptions();
      setSubscriptions(list);
    } catch (err) {
      toastCatch('WebhookSubscriptionsPanel:list')(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    listKnownEventTypes()
      .then(setVocabulary)
      .catch(silentCatch('features/settings/sub_notifications/components/WebhookSubscriptionsPanel:vocabulary'));
  }, [reload]);

  const openCreate = () => setDraft({ ...EMPTY_WEBHOOK_DRAFT });

  const openEdit = (sub: NotificationSubscription) => {
    setDraft({
      id: sub.id,
      label: sub.label,
      provider: isWebhookProvider(sub.provider) ? sub.provider : 'generic',
      webhookUrl: sub.webhookUrl ?? '',
      eventTypes: eventTypesToString(sub.eventTypes),
      templateBody: sub.templateBody ?? '',
      enabled: sub.enabled,
    });
  };

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const payload = draftToPayload(draft);
    try {
      if (draft.id) {
        await updateNotificationSubscription(draft.id, payload);
      } else {
        await createNotificationSubscription(payload);
      }
      setDraft(null);
      await reload();
    } catch (err) {
      toastCatch('WebhookSubscriptionsPanel:save')(err);
    }
  }, [draft, reload]);

  const removeSubscription = useCallback(
    async (id: string) => {
      try {
        await deleteNotificationSubscription(id);
        await reload();
      } catch (err) {
        toastCatch('WebhookSubscriptionsPanel:delete')(err);
      }
    },
    [reload],
  );

  const toggleEnabled = useCallback(
    async (sub: NotificationSubscription) => {
      try {
        await updateNotificationSubscription(sub.id, {
          label: null,
          provider: null,
          webhookUrl: null,
          credentialId: null,
          eventTypes: null,
          templateBody: null,
          enabled: !sub.enabled,
        });
        await reload();
      } catch (err) {
        toastCatch('WebhookSubscriptionsPanel:toggle')(err);
      }
    },
    [reload],
  );

  // The test dispatch records into the same delivery ledger the row's health
  // line reads (record_delivery), so a reload is what surfaces its outcome.
  const runTest = useCallback(
    async (id: string) => {
      try {
        await testNotificationSubscription(id);
      } catch (err) {
        toastCatch('WebhookSubscriptionsPanel:test')(err);
      }
      await reload();
    },
    [reload],
  );

  const showGhost = loading && subscriptions.length === 0 && !draft;

  return (
    // eslint-disable-next-line custom/prefer-section-card -- bespoke panel: bordered header + flush divide-y list that SectionCard's padded body can't express
    <div className="rounded-modal border border-primary/12 bg-secondary/30 shadow-elevation-1 overflow-hidden">
      <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Webhook className="w-4 h-4 text-primary/60" />
          <span className="typo-heading text-primary">
            {s.webhook_subscriptions_title}
          </span>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1 rounded-interactive px-2.5 py-1 typo-caption text-foreground hover:bg-primary/10"
          data-testid="webhook-subscriptions-add"
        >
          <Plus className="w-3.5 h-3.5" />
          {s.webhook_subscriptions_add}
        </button>
      </div>
      <div className="divide-y divide-primary/10">
        {showGhost ? (
          <WebhookListGhostRows />
        ) : subscriptions.length === 0 && !draft ? (
          <div className="px-4 py-6 typo-body text-foreground text-center">
            {s.webhook_subscriptions_empty}
          </div>
        ) : null}
        {subscriptions.map((sub) => (
          <div key={sub.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="typo-body text-foreground truncate">{sub.label}</span>
                <span className="typo-caption text-foreground uppercase tracking-wider">
                  {sub.provider}
                </span>
              </div>
              <div className="typo-caption text-foreground truncate">
                {eventTypesToString(sub.eventTypes)}
              </div>
              <WebhookRowHealth sub={sub} vocabulary={vocabulary} />
            </div>
            <div className="flex items-center gap-1">
              <AsyncButton
                variant="ghost"
                size="icon-sm"
                onClick={() => runTest(sub.id)}
                aria-label={s.webhook_subscriptions_test_aria}
                icon={<Send className="w-3.5 h-3.5 text-primary/60" />}
              />
              <button
                type="button"
                onClick={() => openEdit(sub)}
                className="rounded-interactive p-1.5 hover:bg-primary/10"
                aria-label={s.webhook_subscriptions_edit_aria}
              >
                <Pencil className="w-3.5 h-3.5 text-primary/60" />
              </button>
              <button
                type="button"
                onClick={() => removeSubscription(sub.id)}
                className="rounded-interactive p-1.5 hover:bg-red-500/10"
                aria-label={s.webhook_subscriptions_delete_aria}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
              <AccessibleToggle
                checked={sub.enabled}
                onChange={() => toggleEnabled(sub)}
                label={s.webhook_subscriptions_enabled_aria}
                size="sm"
              />
            </div>
          </div>
        ))}
        {draft && (
          <WebhookDraftForm
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={saveDraft}
            vocabulary={vocabulary}
          />
        )}
      </div>
    </div>
  );
}

interface WebhookRowHealthProps {
  sub: NotificationSubscription;
  vocabulary: EventVocabularyEntry[] | null;
}

/** Delivery ledger (last delivery, status, verbatim error) and a dead-pattern warning, where the row lives. */
function WebhookRowHealth({ sub, vocabulary }: WebhookRowHealthProps) {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  const health = deliveryHealth(sub);
  const patterns = parseEventTypes(eventTypesToString(sub.eventTypes));
  const verdicts = vocabulary ? classifyPatterns(patterns, vocabulary) : [];
  const dead = verdicts.length > 0 && verdicts.every((v) => v.status === 'unknown');
  const suggestion = verdicts.find((v) => v.suggestion)?.suggestion;
  return (
    <div className="typo-caption mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5" data-testid="webhook-row-health">
      {health.tone === 'idle' && (
        <span className="inline-flex items-center gap-1 text-foreground">
          <CircleDashed className="w-3 h-3" />
          {s.webhook_health_never}
        </span>
      )}
      {health.tone === 'ok' && (
        <span className="inline-flex items-center gap-1 text-status-success">
          <CheckCircle2 className="w-3 h-3" />
          {s.webhook_health_ok}
          <RelativeTime timestamp={health.at} />
        </span>
      )}
      {health.tone === 'error' && (
        <Tooltip content={health.error ?? s.webhook_health_error}>
          <span className="inline-flex items-center gap-1 text-status-error min-w-0">
            <XCircle className="w-3 h-3 flex-shrink-0" />
            {s.webhook_health_error}
            <RelativeTime timestamp={health.at} showTooltip={false} />
            {health.error && <span className="truncate max-w-[16rem] font-mono">{health.error}</span>}
          </span>
        </Tooltip>
      )}
      {dead && (
        <span className="inline-flex items-center gap-1 text-status-warning">
          <AlertTriangle className="w-3 h-3" />
          {s.webhook_row_dead}
          {suggestion && <span className="font-mono">{interpolate(s.webhook_pattern_suggest, { suggestion })}</span>}
        </span>
      )}
    </div>
  );
}

const WEBHOOK_GHOST_BAR = 'rounded bg-primary/[0.06]';

function WebhookListGhostRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="px-4 py-3 flex items-center justify-between gap-3 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className={`block h-3.5 w-36 ${WEBHOOK_GHOST_BAR}`} />
            <span className={`block h-2.5 w-48 ${WEBHOOK_GHOST_BAR}`} />
          </div>
          <div className="flex items-center gap-1">
            <span className={`h-6 w-6 rounded-interactive ${WEBHOOK_GHOST_BAR}`} />
            <span className={`h-6 w-6 rounded-interactive ${WEBHOOK_GHOST_BAR}`} />
            <span className={`h-6 w-6 rounded-interactive ${WEBHOOK_GHOST_BAR}`} />
            <span className={`h-5 w-8 rounded-full ${WEBHOOK_GHOST_BAR}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
