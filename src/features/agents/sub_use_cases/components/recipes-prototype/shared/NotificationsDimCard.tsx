import { useState } from 'react';
import { ChevronDown, Bell, Check } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useAgentStore } from '@/stores/agentStore';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import { CHANNEL_TYPES } from '../../../libs/useCaseDetailHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { DisplayUseCase } from './displayUseCase';

interface NotificationsDimCardProps {
  uc: DisplayUseCase;
  personaId: string;
}

/**
 * Interactive Notifications dim card — clickable, opens a Listbox of
 * channel types (Slack / Telegram / Email) so the user can toggle each
 * one on or off for this use case. Persists via `mutateSingleUseCase`,
 * mutating `notification_channels` directly.
 *
 * Channel-specific config (e.g. which Slack channel id to send to) is
 * still owned by the per-channel form on the legacy `UseCaseDetailPanel`
 * (Config tab) — this card only manages the *which types* axis.
 */
export function NotificationsDimCard({ uc, personaId }: NotificationsDimCardProps) {
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const { t, tx } = useTranslation();
  const channels = uc.raw.notification_channels ?? [];
  const dimColor = DIM_META.message.color;
  const active = uc.dimensions.includes('message');
  const [pending, setPending] = useState<NotificationChannelType | null>(null);

  const handleToggle = async (type: NotificationChannelType) => {
    const has = channels.some((c) => c.type === type);
    const next: NotificationChannel[] = has
      ? channels.filter((c) => c.type !== type)
      : [...channels, { type, enabled: true, config: {} }];
    setPending(type);
    try {
      await mutateSingleUseCase(personaId, uc.id, (existing) => ({
        ...existing,
        notification_channels: next.length > 0 ? next : undefined,
      }));
      await fetchDetail(personaId);
      useToastStore.getState().addToast(
        has
          ? tx(t.agents.use_cases.notifications_channel_removed, { type: capitalize(type) })
          : tx(t.agents.use_cases.notifications_channel_added, { type: capitalize(type) }),
        'success',
      );
    } catch (err) {
      toastCatch('NotificationsDimCard:toggle')(err);
    } finally {
      setPending(null);
    }
  };

  const summary = uc.notificationChannels.length === 0
    ? t.agents.use_cases.notifications_none
    : uc.notificationChannels.map(capitalize).join(', ');

  return (
    <Listbox
      ariaLabel={t.agents.use_cases.notifications_aria}
      itemCount={CHANNEL_TYPES.length}
      onSelectFocused={(i) => {
        const ch = CHANNEL_TYPES[i];
        if (ch) void handleToggle(ch.type);
      }}
      menuClassName="animate-fade-slide-in absolute top-full mt-1 left-0 right-0 bg-card-bg border border-card-border rounded-xl shadow-elevation-4 z-[100] overflow-hidden"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          aria-expanded={isOpen}
          className={`w-full text-left rounded-card border bg-secondary/30 px-3 py-2 transition-colors cursor-pointer hover:border-foreground/40 ${
            active ? 'border-card-border' : 'border-border/30 opacity-65 hover:opacity-100'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="flex items-center justify-center rounded"
              style={{
                width: 18, height: 18,
                background: active ? `${dimColor}1f` : 'rgba(148,163,184,0.12)',
                border: `1px solid ${active ? dimColor + '55' : 'rgba(148,163,184,0.25)'}`,
              }}
            >
              <Bell className="w-3 h-3" style={{ color: active ? dimColor : '#94a3b8' }} />
            </span>
            <span className="typo-label uppercase tracking-wider text-foreground">{t.agents.use_cases.notifications_dim_title}</span>
            <ChevronDown className={`ml-auto w-3 h-3 text-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
          <div className="typo-caption text-foreground/85 leading-snug truncate">
            {summary}
          </div>
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1" onClick={(e) => e.stopPropagation()}>
          <div className="px-3 pt-1.5 pb-1 typo-label uppercase tracking-wider text-foreground">
            {t.agents.use_cases.notifications_channel_types}
          </div>
          {CHANNEL_TYPES.map(({ type, label, Icon }, i) => {
            const isOn = channels.some((c) => c.type === type);
            const isFocused = focusIndex === i;
            const isPending = pending === type;
            return (
              <button
                key={type}
                role="option"
                aria-selected={isOn}
                disabled={isPending}
                onClick={() => { void handleToggle(type); close(); }}
                className={`flex items-center gap-2 w-full px-3 py-2 typo-caption transition-colors cursor-pointer text-left disabled:cursor-wait ${
                  isFocused ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                } ${isOn ? 'text-status-success/95' : 'text-foreground'} ${
                  isPending ? 'opacity-50' : ''
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 font-medium">{label}</span>
                {isOn ? (
                  <Check className="w-3.5 h-3.5 text-status-success shrink-0" />
                ) : (
                  <span className="typo-label uppercase tracking-wider text-foreground">{t.agents.use_cases.notifications_channel_off}</span>
                )}
              </button>
            );
          })}
          <div className="border-t border-card-border/60 mt-1 pt-1">
            <div className="px-3 py-2 typo-label uppercase tracking-wider text-foreground">
              {t.agents.use_cases.notifications_config_hint}
            </div>
          </div>
        </div>
      )}
    </Listbox>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
