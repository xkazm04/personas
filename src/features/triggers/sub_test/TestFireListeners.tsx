/**
 * The "Listeners (N)" panel on the Test tab: who is standing by for the
 * selected event type, and - once fired - what the result actually lets us
 * say about each of them. See `testFireListeners.ts`.
 */
import { Ear, CheckCircle2, MinusCircle, HelpCircle, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ListenerDelivery, ListenerRow } from './testFireRouting';
import { deliveryForListener } from './testFireRouting';

const DELIVERY_ICON = {
  targeted: CheckCircle2,
  'not-targeted': MinusCircle,
  unknown: HelpCircle,
  disabled: PowerOff,
} as const;

const DELIVERY_TONE: Record<ListenerDelivery, string> = {
  targeted: 'text-status-success',
  'not-targeted': 'text-ink-1',
  unknown: 'text-ink-1',
  disabled: 'text-status-warning',
};

interface TestFireListenersProps {
  listeners: ListenerRow[];
  /** Resolve a persona id to its display name. */
  personaName: (personaId: string) => string;
  /** The fired event's target, or null when nothing has been fired yet. */
  targetPersonaId: string | null;
  /** Whether a fire has completed, so the rows may report an outcome. */
  fired: boolean;
  /** The fired event's source_id (null for a test fire), for source-filtered listeners. */
  sourceId?: string | null;
  /** A listener read failed: an empty list here says nothing, so do not claim none. */
  readFailed?: boolean;
}

export function TestFireListeners({
  listeners,
  personaName,
  targetPersonaId,
  fired,
  sourceId = null,
  readFailed = false,
}: TestFireListenersProps) {
  const { t, tx } = useTranslation();
  const tr = t.triggers;

  return (
    <section
      className="rounded-modal border border-hair bg-surface-1 p-4 space-y-2"
      data-testid="test-fire-listeners"
    >
      <h4 className="typo-title flex items-center gap-1.5">
        <Ear className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {tx(tr.test_listeners_header, { count: listeners.length })}
      </h4>

      {listeners.length === 0 ? (
        !readFailed && <p className="typo-caption text-ink-2">{tr.test_listeners_none}</p>
      ) : (
        <ul className="space-y-1">
          {listeners.map((row) => {
            const delivery = fired
              ? deliveryForListener(row, targetPersonaId, sourceId)
              : row.enabled
                ? null
                : 'disabled';
            const Icon = delivery ? DELIVERY_ICON[delivery] : null;
            return (
              <li
                key={row.subscriptionId}
                className="flex items-center gap-2 typo-caption"
                data-testid={`test-fire-listener-${row.personaId}`}
                data-delivery={delivery ?? 'pending'}
              >
                <span className="text-ink-1 font-medium truncate">
                  {personaName(row.personaId)}
                </span>
                {row.sourceFilter && (
                  <span className="text-ink-1 truncate">
                    {tx(tr.test_listeners_filtered, { filter: row.sourceFilter })}
                  </span>
                )}
                {delivery && Icon && (
                  <span className={`inline-flex items-center gap-1 ml-auto ${DELIVERY_TONE[delivery]}`}>
                    <Icon className="w-3 h-3 shrink-0" aria-hidden />
                    {delivery === 'targeted'
                      ? tr.test_listeners_targeted
                      : delivery === 'not-targeted'
                        ? tr.test_listeners_not_targeted
                        : delivery === 'disabled'
                          ? tr.test_listeners_disabled
                          : tr.test_listeners_unknown}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
