/**
 * Combined capability + trigger composition step — Neon styling.
 *
 * All color choices go through semantic theme tokens — `brand-cyan`,
 * `brand-purple`, `primary`, `foreground`, `secondary`, `border` —
 * which color-mix across the theme palette so the step flips cleanly
 * between dark and light themes without hardcoded cyan/violet escapes.
 *
 * Layout: header with centered "Choose capabilities" + template goal
 * as subtitle. 2-column card grid. Each enabled card has inline
 * trigger configuration with two mutually-exclusive families:
 *   - Time (Hourly / Daily / Weekly)
 *   - Event
 * Manual is the implicit default — no chip. Custom cron is not exposed.
 * Families hidden behind enable toggles when the template doesn't
 * define them; visible from the start when it does.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Check, ChevronDown, ChevronRight, Clock, Plus, Sparkles, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  TIME_PRESETS,
  WEEKDAYS,
  clampHour,
  disableEventFamily,
  disableTimeFamily,
  enableEventFamily,
  enableTimeFamily,
  hasEvent,
  hasTime,
  makeTriggerUpdater,
  selectionForTimePreset,
  updateEvent,
  updateTime,
  type TriggerSelection,
  type UseCasePickerVariantProps,
} from './useCasePickerShared';

export function UseCasePickerStepNeon({
  templateGoal,
  useCases,
  selectedIds,
  availableEvents,
  triggerComposition,
  triggerSelections,
  onToggle,
  onTriggerChange,
  onContinue,
}: UseCasePickerVariantProps) {
  const { t } = useTranslation();
  const selectedCount = useCases.filter((u) => selectedIds.has(u.id)).length;
  const canContinue = selectedCount > 0;

  const [expandedDescId, setExpandedDescId] = useState<Set<string>>(new Set());
  const toggleDesc = (id: string) =>
    setExpandedDescId((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEvents.map((e) => ({ value: e, label: e })),
    [availableEvents],
  );

  const updateTrigger = useMemo(
    () => makeTriggerUpdater(useCases, triggerComposition, triggerSelections, onTriggerChange),
    [useCases, triggerComposition, triggerSelections, onTriggerChange],
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Centered header — "Choose capabilities" with goal below */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-border">
        <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-2">
          <div className="inline-flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-brand-purple" />
            <h2 className="text-xl font-semibold text-foreground">Choose capabilities</h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 typo-body font-mono uppercase tracking-[0.12em] text-foreground bg-gradient-to-r from-primary/20 to-brand-purple/20 ring-1 ring-primary/30">
            <Activity className="w-3 h-3" />
            {triggerComposition === 'shared' ? 'shared trigger' : 'per-UC triggers'}
          </span>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/70 leading-relaxed">{templateGoal}</p>
          ) : null}
        </div>
      </div>

      {triggerComposition === 'shared' && (
        <div className="flex-shrink-0 px-6 py-2 bg-gradient-to-r from-brand-cyan/10 via-brand-purple/5 to-brand-cyan/10 border-b border-brand-purple/25 typo-body-lg text-foreground/80 text-center">
          All capabilities fire on the same tick. Changing any card applies to all.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min">
          {useCases.map((uc, idx) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? ({} as TriggerSelection);
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            const subtitle = uc.capability_summary ?? uc.description ?? null;
            return (
              <motion.div
                key={uc.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={`rounded-xl p-4 flex flex-col gap-3 transition-colors ${
                  enabled
                    ? 'ring-1 ring-primary/40 bg-gradient-to-br from-primary/10 via-transparent to-brand-purple/10 shadow-elevation-2'
                    : 'ring-1 ring-border bg-foreground/[0.02]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`focus-ring flex-shrink-0 mt-1 w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-primary ring-1 ring-primary'
                        : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
                    }`}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-background" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => onToggle(uc.id)} className="text-left w-full">
                      <div
                        className={`text-3xl font-semibold leading-tight tracking-tight ${
                          enabled ? 'text-foreground' : 'text-foreground/70'
                        }`}
                      >
                        {uc.name}
                      </div>
                      {subtitle && (
                        <div
                          className={`mt-1.5 typo-body-lg leading-relaxed ${
                            enabled ? 'text-foreground/80' : 'text-foreground/55'
                          }`}
                        >
                          {subtitle}
                        </div>
                      )}
                    </button>
                    {hasDescription && (
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        className="mt-2 inline-flex items-center gap-1 typo-body-lg text-brand-cyan hover:text-brand-cyan/80"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${descExpanded ? 'rotate-180' : ''}`}
                        />
                        {descExpanded ? 'Hide details' : 'Show details'}
                      </button>
                    )}
                    {descExpanded && hasDescription && (
                      <p
                        className={`mt-2 typo-body-lg leading-relaxed ${
                          enabled ? 'text-foreground/65' : 'text-foreground/40'
                        }`}
                      >
                        {uc.description}
                      </p>
                    )}
                  </div>
                </div>

                {enabled && (
                  <TriggerFamilies
                    selection={sel ?? {}}
                    availableEvents={eventOptions}
                    availableEventKeys={availableEvents}
                    onChange={(next) => updateTrigger(uc.id, next)}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body-lg text-foreground/55">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body-lg font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
          >
            {t.templates.adopt_modal.use_cases_continue}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface TriggerFamiliesProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
}

/**
 * Renders both trigger families independently. Either, neither, or
 * BOTH can be active simultaneously — enabling one does not collapse
 * the other. Templates whose author wanted a UC to fire on the weekly
 * tick AND also react to a cross-capability event can express that
 * by turning on both panels.
 */
function TriggerFamilies({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
}: TriggerFamiliesProps) {
  return (
    <div className="flex flex-col gap-2">
      {hasTime(selection) ? (
        <TimeFamilyPanel
          selection={selection}
          onChange={onChange}
          onDisable={() => onChange(disableTimeFamily(selection))}
        />
      ) : (
        <AddFamilyButton
          label="Time trigger"
          icon={Clock}
          onClick={() => onChange(enableTimeFamily(selection))}
        />
      )}

      {hasEvent(selection) ? (
        <EventFamilyPanel
          selection={selection}
          availableEvents={availableEvents}
          onChange={onChange}
          onDisable={() => onChange(disableEventFamily(selection))}
        />
      ) : (
        <AddFamilyButton
          label="Event trigger"
          icon={Zap}
          onClick={() => onChange(enableEventFamily(selection, availableEventKeys))}
        />
      )}
    </div>
  );
}

function AddFamilyButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Clock;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg border border-dashed border-foreground/15 text-foreground/60 typo-body-lg font-medium hover:border-brand-cyan/40 hover:text-brand-cyan hover:bg-brand-cyan/5 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

interface FamilyPanelProps {
  selection: TriggerSelection;
  onChange: (next: TriggerSelection) => void;
  onDisable: () => void;
}

function TimeFamilyPanel({ selection, onChange, onDisable }: FamilyPanelProps) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;

  return (
    <div className="rounded-xl ring-1 ring-primary/25 bg-primary/5 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body-lg font-mono uppercase tracking-wider text-brand-cyan">
          <Clock className="w-3.5 h-3.5" />
          Time trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="p-1 rounded hover:bg-foreground/[0.08] text-foreground/50 hover:text-foreground transition-colors"
          aria-label="Remove time trigger"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TIME_PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = sub === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForTimePreset(p.key, selection))}
              className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/50 tracking-wide'
                  : 'bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {sub === 'daily' && (
        <div className="flex items-center gap-2 typo-body-lg">
          <span className="text-foreground/55 font-mono">at</span>
          <input
            type="number"
            min={0}
            max={23}
            value={hourOfDay}
            onChange={(e) =>
              onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))
            }
            className="focus-ring w-14 rounded-md ring-1 ring-primary/30 focus:ring-primary bg-primary/10 px-2 py-1 font-mono text-foreground focus:outline-none text-center"
          />
          <span className="text-foreground/55 font-mono">:00</span>
        </div>
      )}

      {sub === 'weekly' && (
        <div className="flex flex-col gap-2">
          {/* Days row */}
          <div className="flex items-center gap-2 typo-body-lg">
            <span className="text-foreground/55 font-mono">on</span>
            <div className="inline-flex gap-1 rounded-lg ring-1 ring-border bg-gradient-to-r from-primary/10 to-brand-purple/10 p-1">
              {WEEKDAYS.map((d, i) => {
                const isActive = weekday === i;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onChange(updateTime(selection, { weekday: i }))}
                    className={`rounded-md px-2 py-0.5 font-mono transition-colors ${
                      isActive
                        ? 'bg-brand-cyan/25 text-brand-cyan'
                        : 'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05]'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Hour row — separate so the hour input never wraps mid-row */}
          <div className="flex items-center gap-2 typo-body-lg">
            <span className="text-foreground/55 font-mono">at</span>
            <input
              type="number"
              min={0}
              max={23}
              value={hourOfDay}
              onChange={(e) =>
                onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))
              }
              className="focus-ring w-14 rounded-md ring-1 ring-primary/30 focus:ring-primary bg-primary/10 px-2 py-1 font-mono text-foreground focus:outline-none text-center"
            />
            <span className="text-foreground/55 font-mono">:00</span>
          </div>
        </div>
      )}

      {sub === 'hourly' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          ▸ cron <span className="text-brand-cyan">0 * * * *</span>
        </p>
      )}
    </div>
  );
}

interface EventFamilyPanelProps extends FamilyPanelProps {
  availableEvents: ThemedSelectOption[];
}

function EventFamilyPanel({
  selection,
  availableEvents,
  onChange,
  onDisable,
}: EventFamilyPanelProps) {
  return (
    <div className="rounded-xl ring-1 ring-brand-purple/25 bg-brand-purple/5 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body-lg font-mono uppercase tracking-wider text-brand-purple">
          <Zap className="w-3.5 h-3.5" />
          Event trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="p-1 rounded hover:bg-foreground/[0.08] text-foreground/50 hover:text-foreground transition-colors"
          aria-label="Remove event trigger"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 typo-body-lg">
        <span className="text-foreground/55 font-mono">listen for</span>
        <ThemedSelect
          wrapperClassName="flex-1 min-w-0 max-w-md"
          filterable
          options={
            availableEvents.length > 0
              ? availableEvents
              : [{ value: '', label: '(no events defined by any capability)' }]
          }
          value={selection.event?.eventType ?? ''}
          onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
          placeholder="Pick an event"
        />
      </div>
    </div>
  );
}
