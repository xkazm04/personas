import { useCallback, useEffect, useMemo, useState } from 'react';
import { Webhook, Plus, Trash2, Send, Loader2, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  createNotificationSubscription,
  deleteNotificationSubscription,
  listNotificationSubscriptions,
  testNotificationSubscription,
  updateNotificationSubscription,
} from '@/api/events/notificationSubscriptions';
import type { NotificationSubscription } from '@/lib/bindings/NotificationSubscription';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

type Provider = 'slack' | 'discord' | 'teams' | 'generic';

interface DraftSubscription {
  id?: string;
  label: string;
  provider: Provider;
  webhookUrl: string;
  eventTypes: string;
  templateBody: string;
  enabled: boolean;
}

const EMPTY_DRAFT: DraftSubscription = {
  label: '',
  provider: 'slack',
  webhookUrl: '',
  eventTypes: 'execution.finished, healing.escalated',
  templateBody: '',
  enabled: true,
};

const PROVIDER_OPTIONS: Array<{ value: Provider; labelKey: 'slack' | 'discord' | 'teams' | 'generic' }> = [
  { value: 'slack', labelKey: 'slack' },
  { value: 'discord', labelKey: 'discord' },
  { value: 'teams', labelKey: 'teams' },
  { value: 'generic', labelKey: 'generic' },
];

function parseEventTypes(raw: string): string[] {
  return raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function eventTypesToString(arr: string): string {
  try {
    const parsed = JSON.parse(arr) as unknown;
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch (err) { silentCatch("features/settings/sub_notifications/components/WebhookSubscriptionsPanel:catch1")(err); }
  return arr;
}

export function WebhookSubscriptionsPanel() {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftSubscription | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<Record<string, { ok: boolean; msg: string }>>({});

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
  }, [reload]);

  const openCreate = () => setDraft({ ...EMPTY_DRAFT });

  const openEdit = (sub: NotificationSubscription) => {
    setDraft({
      id: sub.id,
      label: sub.label,
      provider: (PROVIDER_OPTIONS.find((p) => p.value === sub.provider)?.value ?? 'generic') as Provider,
      webhookUrl: sub.webhookUrl ?? '',
      eventTypes: eventTypesToString(sub.eventTypes),
      templateBody: sub.templateBody ?? '',
      enabled: sub.enabled,
    });
  };

  const closeDraft = () => setDraft(null);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const eventTypes = parseEventTypes(draft.eventTypes);
    const payload = {
      label: draft.label.trim(),
      provider: draft.provider,
      webhookUrl: draft.webhookUrl.trim() || null,
      credentialId: null,
      eventTypes,
      templateBody: draft.templateBody.trim() || null,
      enabled: draft.enabled,
    };
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

  const runTest = useCallback(async (id: string) => {
    setTestingId(id);
    try {
      const result = await testNotificationSubscription(id);
      setLastTest((prev) => ({
        ...prev,
        [id]: {
          ok: result.ok,
          msg: result.ok
            ? `HTTP ${result.statusCode ?? 200}`
            : result.error ?? `HTTP ${result.statusCode ?? 'error'}`,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastTest((prev) => ({ ...prev, [id]: { ok: false, msg: message } }));
    } finally {
      setTestingId(null);
    }
  }, []);

  const isValidDraft = useMemo(() => {
    if (!draft) return false;
    if (!draft.label.trim()) return false;
    if (!draft.webhookUrl.trim()) return false;
    if (parseEventTypes(draft.eventTypes).length === 0) return false;
    return true;
  }, [draft]);

  if (loading) return null;

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
          className="inline-flex items-center gap-1 rounded-interactive px-2.5 py-1 typo-caption font-medium text-foreground hover:bg-primary/10"
          data-testid="webhook-subscriptions-add"
        >
          <Plus className="w-3.5 h-3.5" />
          {s.webhook_subscriptions_add}
        </button>
      </div>
      <div className="divide-y divide-primary/10">
        {subscriptions.length === 0 && !draft && (
          <div className="px-4 py-6 typo-body text-foreground text-center">
            {s.webhook_subscriptions_empty}
          </div>
        )}
        {subscriptions.map((sub) => {
          const test = lastTest[sub.id];
          return (
            <div key={sub.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="typo-body font-medium text-foreground truncate">{sub.label}</span>
                  <span className="typo-caption text-foreground uppercase tracking-wider">
                    {sub.provider}
                  </span>
                </div>
                <div className="typo-caption text-foreground truncate">
                  {eventTypesToString(sub.eventTypes)}
                </div>
                {test && (
                  <div className="typo-caption mt-0.5 flex items-center gap-1">
                    {test.ok ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-400" />
                    )}
                    <span className={test.ok ? 'text-emerald-400' : 'text-red-400'}>{test.msg}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => runTest(sub.id)}
                  disabled={testingId === sub.id}
                  className="rounded-interactive p-1.5 hover:bg-primary/10 disabled:opacity-50"
                  aria-label={s.webhook_subscriptions_test_aria}
                >
                  {testingId === sub.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/60" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-primary/60" />
                  )}
                </button>
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
          );
        })}
        {draft && (
          <div className="px-4 py-4 space-y-3 bg-primary/5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="typo-caption text-foreground">{s.webhook_subscriptions_label}</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground"
                  placeholder={s.webhook_subscriptions_label_placeholder}
                  data-testid="webhook-draft-label"
                />
              </label>
              <label className="block">
                <span className="typo-caption text-foreground">{s.webhook_subscriptions_provider}</span>
                <select
                  value={draft.provider}
                  onChange={(e) => setDraft({ ...draft, provider: e.target.value as Provider })}
                  className="mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground"
                >
                  {PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {s.webhook_subscriptions_provider_labels[opt.labelKey]}
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
                onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
                className="mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground font-mono"
                placeholder={s.webhook_subscriptions_url_placeholder}
                data-testid="webhook-draft-url"
              />
            </label>
            <label className="block">
              <span className="typo-caption text-foreground">{s.webhook_subscriptions_events}</span>
              <input
                type="text"
                value={draft.eventTypes}
                onChange={(e) => setDraft({ ...draft, eventTypes: e.target.value })}
                className="mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground font-mono"
                placeholder={s.webhook_subscriptions_events_placeholder}
              />
              <span className="typo-caption text-foreground mt-1 block">
                {s.webhook_subscriptions_events_hint}
              </span>
            </label>
            <label className="block">
              <span className="typo-caption text-foreground">{s.webhook_subscriptions_template}</span>
              <textarea
                value={draft.templateBody}
                onChange={(e) => setDraft({ ...draft, templateBody: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground font-mono"
                placeholder={s.webhook_subscriptions_template_placeholder}
              />
              <span className="typo-caption text-foreground mt-1 block">
                {s.webhook_subscriptions_template_hint}
              </span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDraft}
                className="rounded-interactive px-3 py-1 typo-caption text-foreground hover:bg-primary/10"
              >
                {s.webhook_subscriptions_cancel}
              </button>
              <button
                type="button"
                onClick={saveDraft}
                disabled={!isValidDraft}
                className="rounded-interactive px-3 py-1 typo-caption font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
                data-testid="webhook-draft-save"
              >
                {s.webhook_subscriptions_save}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
