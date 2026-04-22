// Top "power rail" panel for the edit mode. Hosts the Source indicator,
// Time + Event family controls, and an emitting counter. 14-segment LED
// strip at the top chases during test firing.

import { motion } from 'framer-motion';
import { Clock, Cog, Plus, PowerOff, Radio, X, Zap } from 'lucide-react';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  disableEventFamily,
  disableTimeFamily,
  enableEventFamily,
  enableTimeFamily,
  hasEvent,
  hasTime,
  updateEvent,
  type TriggerSelection,
} from '../useCasePickerShared';
import { LED, TimeControls } from './ucTimeControls';

export function PowerRail({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
  status,
  subscribedCount,
}: {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
  status: 'idle' | 'running' | 'done';
  subscribedCount: number;
}) {
  const firing = status === 'running';
  const poweredTime = hasTime(selection);
  const poweredEvent = hasEvent(selection);
  const powered = poweredTime || poweredEvent;
  return (
    <div className="relative rounded-card ring-1 ring-border/80 bg-gradient-to-b from-foreground/[0.035] to-foreground/[0.015] overflow-hidden shadow-elevation-1">
      <div className="flex items-center gap-1 px-6 pt-2.5">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.span
            key={i}
            className={`h-1 flex-1 rounded-full ${powered ? 'bg-primary/70' : 'bg-foreground/15'}`}
            animate={firing ? { opacity: [0.3, 1, 0.3] } : {}}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.05, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <div className="flex items-start gap-4 px-6 py-3">
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 transition-colors ${
              powered
                ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1'
                : 'ring-border bg-background text-foreground/40'
            }`}
          >
            {powered ? <Radio className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
          </div>
          <span className="typo-caption uppercase tracking-wider text-foreground/55 font-semibold">
            Source
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-primary">
              <Clock className="w-3.5 h-3.5" /> Time trigger <LED on={poweredTime} accent="primary" />
            </div>
            {poweredTime ? (
              <button
                type="button"
                onClick={() => onChange(disableTimeFamily(selection))}
                className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange(enableTimeFamily(selection))}
                className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-primary hover:bg-primary/10 typo-caption"
              >
                <Plus className="w-3 h-3" /> enable
              </button>
            )}
          </div>
          {poweredTime && <TimeControls selection={selection} onChange={onChange} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-status-info">
              <Zap className="w-3.5 h-3.5" /> Event trigger <LED on={poweredEvent} accent="info" />
            </div>
            {poweredEvent ? (
              <button
                type="button"
                onClick={() => onChange(disableEventFamily(selection))}
                className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange(enableEventFamily(selection, availableEventKeys))}
                className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-status-info hover:bg-status-info/10 typo-caption"
              >
                <Plus className="w-3 h-3" /> enable
              </button>
            )}
          </div>
          {poweredEvent && (
            <ThemedSelect
              filterable
              options={
                availableEvents.length > 0
                  ? availableEvents
                  : [{ value: '', label: '(no events declared)' }]
              }
              value={selection.event?.eventType ?? ''}
              onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
              placeholder="Pick an event"
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-1 pt-1 pr-1">
          <div className="inline-flex items-center gap-1.5 typo-caption font-mono text-foreground/65">
            <Cog className="w-3.5 h-3.5" />
            <span className="tabular-nums text-foreground font-semibold">{subscribedCount}</span>
            emitting
          </div>
          <span className="typo-caption uppercase tracking-wider text-foreground/45 font-semibold">
            events
          </span>
        </div>
      </div>
    </div>
  );
}
