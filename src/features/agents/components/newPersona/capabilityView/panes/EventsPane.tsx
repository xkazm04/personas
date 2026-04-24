import { Bell, Radio } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { CapabilityState } from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

export function EventsPane({ capability }: Props) {
  const { t } = useTranslation();
  const events = capability.event_subscriptions ?? [];
  const channels = capability.notification_channels ?? [];

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      data-testid={`capability-events-pane-${capability.id}`}
    >
      <section className="flex flex-col gap-2">
        <header className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-foreground/60" />
          <h4 className="typo-label text-foreground/70">
            {t.matrix_v3.capability_row_field_events}
          </h4>
        </header>
        {events.length === 0 ? (
          <p className="typo-body-sm text-foreground/40">
            {t.matrix_v3.capability_row_field_pending}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((ev, i) => (
              <li
                key={`${ev.event_type}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-secondary/25 px-2 py-1.5"
              >
                <span className="typo-caption font-medium uppercase text-foreground/60">
                  {ev.direction}
                </span>
                <span className="typo-body-sm text-foreground truncate">
                  {ev.event_type}
                </span>
                {ev.description ? (
                  <span className="typo-caption text-foreground/50 truncate">
                    {ev.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <header className="flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-foreground/60" />
          <h4 className="typo-label text-foreground/70">
            {t.matrix_v3.capability_row_field_channels}
          </h4>
        </header>
        {channels.length === 0 ? (
          <p className="typo-body-sm text-foreground/40">
            {t.matrix_v3.capability_row_field_pending}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {channels.map((ch, i) => (
              <li
                key={`${ch.channel}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-secondary/25 px-2 py-1.5"
              >
                <span className="typo-caption font-medium uppercase text-foreground/60">
                  {ch.channel}
                </span>
                <span className="typo-body-sm text-foreground truncate">
                  {ch.target}
                </span>
                {ch.format ? (
                  <span className="typo-caption text-foreground/50">
                    ({ch.format})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
