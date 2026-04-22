// Edit-mode body for a single UC card. Renders the Power Rail on top
// and a two-zone grid below: Runs (capability subtitle) → Events (per-
// event destination routing). Kept as a single file since zone headers
// and the pipeline arrow are small inline helpers.

import { ArrowRight, Plus, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { TriggerSelection } from '../useCasePickerShared';
import { PowerRail } from './ucPowerRail';
import { RouteToggle } from './ucRouteToggle';
import { StampGlyph } from './ucStampGlyph';
import { classifyEvent } from './ucPickerHelpers';
import type { Destination, DestId } from './ucPickerTypes';

interface Props {
  ucId: string;
  trigger: TriggerSelection;
  eventOptions: ThemedSelectOption[];
  availableEventKeys: string[];
  emits: Array<{ event_type: string; description: string; default_titlebar: boolean }>;
  ucRoutes: Record<string, Set<DestId>>;
  destinations: Destination[];
  subtitle: string;
  subscribedCount: number;
  status: 'idle' | 'running' | 'done';
  onTriggerChange: (next: TriggerSelection) => void;
  onToggleRoute: (ucId: string, eventType: string, destId: DestId) => void;
  onRemoveChannel: (chId: string) => void;
  onAddChannel: (eventType: string) => void;
}

export function ForgeEditor({
  ucId,
  trigger,
  eventOptions,
  availableEventKeys,
  emits,
  ucRoutes,
  destinations,
  subtitle,
  subscribedCount,
  status,
  onTriggerChange,
  onToggleRoute,
  onRemoveChannel,
  onAddChannel,
}: Props) {
  const firing = status === 'running';
  return (
    <div
      className="relative px-5 py-5 bg-gradient-to-b from-foreground/[0.015] to-foreground/[0.04]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(90deg, transparent 0 19px, color-mix(in srgb, var(--color-foreground) 3%, transparent) 19px 20px)',
      }}
    >
      <PowerRail
        selection={trigger}
        availableEvents={eventOptions}
        availableEventKeys={availableEventKeys}
        onChange={onTriggerChange}
        status={status}
        subscribedCount={subscribedCount}
      />

      <div className="grid grid-cols-[1fr_auto_1.5fr] items-stretch gap-0 mt-4">
        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-foreground/[0.03] p-4">
          <ZoneHeader icon={Sparkles} label="Runs" accent="primary" />
          <p className="typo-body text-foreground/75 leading-snug">{subtitle}</p>
        </div>

        <PipelineArrow firing={firing} />

        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-border/80 bg-status-warning/[0.06] p-4">
          <ZoneHeader icon={Zap} label="Events" accent="status-warning" count={subscribedCount} />
          <div className="flex flex-col gap-1">
            {emits.length === 0 && <div className="typo-body text-foreground/60 italic">No events emitted</div>}
            {emits.map((ev, i) => {
              const routed = ucRoutes[ev.event_type] ?? new Set<DestId>();
              const subscribed = routed.size > 0;
              return (
                <div
                  key={ev.event_type}
                  className={`flex items-center gap-2 px-2 py-2 rounded-input transition-colors ${
                    subscribed ? 'bg-status-warning/[0.10]' : 'bg-foreground/[0.02]'
                  }`}
                >
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                    style={{
                      color: subscribed ? 'var(--color-status-warning)' : 'var(--color-foreground)',
                      opacity: subscribed ? 1 : 0.35,
                      background: subscribed
                        ? 'color-mix(in srgb, var(--color-status-warning) 14%, transparent)'
                        : 'transparent',
                      boxShadow: subscribed
                        ? 'inset 0 0 0 1px color-mix(in srgb, var(--color-status-warning) 40%, transparent)'
                        : 'inset 0 0 0 1px color-mix(in srgb, var(--color-foreground) 15%, transparent)',
                    }}
                  >
                    <StampGlyph kind={classifyEvent(ev.event_type)} size={14} />
                  </div>
                  <span
                    className={`flex-1 min-w-0 typo-body font-medium truncate ${
                      subscribed ? 'text-foreground' : 'text-foreground/75'
                    }`}
                  >
                    {ev.description}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {destinations.map((dest) => (
                      <RouteToggle
                        key={dest.id}
                        destination={dest}
                        active={routed.has(dest.id)}
                        firing={firing && routed.has(dest.id)}
                        delay={i * 0.1 + 0.2}
                        onToggle={() => onToggleRoute(ucId, ev.event_type, dest.id)}
                        onRemove={dest.kind === 'channel' ? () => onRemoveChannel(dest.id) : undefined}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => onAddChannel(ev.event_type)}
                      className="focus-ring w-8 h-8 rounded-full border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneHeader({
  icon: Icon,
  label,
  accent,
  count,
}: {
  icon: LucideIcon;
  label: string;
  accent: 'primary' | 'status-warning';
  count?: number;
}) {
  const textColor = accent === 'primary' ? 'text-primary' : 'text-status-warning';
  const badgeClasses =
    accent === 'primary'
      ? 'bg-primary/20 text-primary ring-primary/30'
      : 'bg-status-warning/20 text-status-warning ring-status-warning/30';
  return (
    <div className={`typo-body uppercase tracking-wider flex items-center gap-2 font-semibold ${textColor}`}>
      <Icon className="w-5 h-5" />
      {label}
      {typeof count === 'number' && (
        <span
          className={`ml-auto inline-flex items-center justify-center min-w-6 h-6 rounded-full px-2 typo-body font-bold ring-1 ${badgeClasses}`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function PipelineArrow({ firing }: { firing: boolean }) {
  return (
    <div className="self-center flex items-center mx-3" aria-hidden>
      <div className="w-3 h-px bg-foreground/25" />
      <ArrowRight className={`w-6 h-6 ${firing ? 'text-status-warning' : 'text-foreground/45'}`} />
    </div>
  );
}
