/**
 * Combined capability + trigger composition step — Neon styling.
 *
 * Layout: header with centered "Choose capabilities" + template goal
 * as subtitle. 2-column card grid. Each enabled card has inline
 * trigger configuration with two mutually-exclusive families:
 *   - Time (Hourly / Daily / Weekly)
 *   - Event
 * Manual is the implicit default — no chip. Custom cron is not exposed.
 *
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
  enableEventFamily,
  enableTimeFamily,
  getFamily,
  makeTriggerUpdater,
  manualSelection,
  selectionForTimePreset,
  type TimePreset,
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
      <div className="flex-shrink-0 px-6 py-5 border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-2">
          <div className="inline-flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-violet-300 drop-shadow-[0_0_6px_rgba(167,139,250,0.6)]" />
            <h2 className="text-xl font-semibold text-foreground">Choose capabilities</h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 typo-body font-mono uppercase tracking-[0.12em] text-cyan-100 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 border border-cyan-400/30">
            <Activity className="w-3 h-3" />
            {triggerComposition === 'shared' ? 'shared trigger' : 'per-UC triggers'}
          </span>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/70 leading-relaxed">{templateGoal}</p>
          ) : null}
        </div>
      </div>

      {triggerComposition === 'shared' && (
        <div className="flex-shrink-0 px-6 py-2 bg-gradient-to-r from-cyan-500/[0.08] via-violet-500/[0.05] to-cyan-500/[0.08] border-b border-violet-500/20 typo-body-lg text-cyan-100 text-center">
          All capabilities fire on the same tick. Changing any card applies to all.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min">
          {useCases.map((uc, idx) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? manualSelection();
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            const subtitle = uc.capability_summary ?? uc.description ?? null;
            return (
              <motion.div
                key={uc.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={`rounded-xl p-4 flex flex-col gap-3 transition-all relative overflow-hidden ${
                  enabled
                    ? 'border border-cyan-400/30 bg-gradient-to-br from-cyan-500/[0.08] via-white/[0.02] to-violet-500/[0.08] shadow-[0_0_28px_-12px_rgba(103,232,249,0.35)]'
                    : 'border border-white/[0.06] bg-white/[0.015]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-1 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                      enabled
                        ? 'bg-cyan-400 border-cyan-300 shadow-[0_0_10px_-2px_rgba(103,232,249,0.8)]'
                        : 'bg-transparent border-white/20 hover:border-white/35'
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
                        className="mt-2 inline-flex items-center gap-1 typo-body-lg text-cyan-200/80 hover:text-cyan-100"
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
                    selection={sel}
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

      <div className="flex-shrink-0 border-t border-white/[0.06]">
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

function TriggerFamilies({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
}: TriggerFamiliesProps) {
  const family = getFamily(selection);

  return (
    <div className="flex flex-col gap-2">
      {/* Time family */}
      {family === 'time' ? (
        <TimeFamilyPanel
          selection={selection}
          onChange={onChange}
          onDisable={() => onChange(manualSelection())}
        />
      ) : (
        <AddFamilyButton
          label="Time trigger"
          icon={Clock}
          onClick={() => onChange(enableTimeFamily(selection))}
        />
      )}

      {/* Event family */}
      {family === 'event' ? (
        <EventFamilyPanel
          selection={selection}
          availableEvents={availableEvents}
          onChange={onChange}
          onDisable={() => onChange(manualSelection())}
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
      className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg border border-dashed border-white/[0.12] text-foreground/60 typo-body-lg font-medium hover:border-cyan-400/40 hover:text-cyan-100 hover:bg-cyan-500/[0.06] transition-colors"
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
  const sub: TimePreset =
    selection.preset === 'hourly' || selection.preset === 'daily' || selection.preset === 'weekly'
      ? selection.preset
      : 'daily';

  return (
    <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body-lg font-mono uppercase tracking-wider text-cyan-200/90">
          <Clock className="w-3.5 h-3.5" />
          Time trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="p-1 rounded hover:bg-white/[0.06] text-foreground/50 hover:text-foreground transition-colors"
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
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 typo-body-lg font-medium transition-all ${
                isActive
                  ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/50 shadow-[0_0_12px_-2px_rgba(103,232,249,0.55)] tracking-wide'
                  : 'bg-white/[0.04] text-foreground/60 hover:bg-white/[0.08] hover:text-foreground'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'drop-shadow-[0_0_4px_rgba(103,232,249,0.8)]' : ''}`} />
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
            value={selection.hourOfDay ?? 9}
            onChange={(e) =>
              onChange({ ...selection, preset: 'daily', hourOfDay: clampHour(e.target.value) })
            }
            className="w-14 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 font-mono text-foreground focus:outline-none focus:border-cyan-300 focus:shadow-[0_0_10px_-2px_rgba(103,232,249,0.55)] text-center"
          />
          <span className="text-foreground/55 font-mono">:00</span>
        </div>
      )}

      {sub === 'weekly' && (
        <div className="flex flex-col gap-2">
          {/* Days row */}
          <div className="flex items-center gap-2 typo-body-lg">
            <span className="text-foreground/55 font-mono">on</span>
            <div className="inline-flex gap-1 rounded-lg border border-white/[0.08] bg-gradient-to-r from-cyan-500/[0.06] to-violet-500/[0.06] p-1">
              {WEEKDAYS.map((d, i) => {
                const isActive = selection.weekday === i;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...selection,
                        preset: 'weekly',
                        weekday: i,
                        hourOfDay: selection.hourOfDay ?? 9,
                      })
                    }
                    className={`rounded-md px-2 py-0.5 font-mono transition-all ${
                      isActive
                        ? 'bg-cyan-500/25 text-cyan-100 shadow-[0_0_10px_-2px_rgba(103,232,249,0.6)]'
                        : 'text-foreground/60 hover:text-foreground hover:bg-white/[0.05]'
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
              value={selection.hourOfDay ?? 9}
              onChange={(e) =>
                onChange({
                  ...selection,
                  preset: 'weekly',
                  hourOfDay: clampHour(e.target.value),
                  weekday: selection.weekday ?? 1,
                })
              }
              className="w-14 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 font-mono text-foreground focus:outline-none focus:border-cyan-300 text-center"
            />
            <span className="text-foreground/55 font-mono">:00</span>
          </div>
        </div>
      )}

      {sub === 'hourly' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          ▸ cron <span className="text-cyan-200">0 * * * *</span>
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
    <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 typo-body-lg font-mono uppercase tracking-wider text-violet-200/90">
          <Zap className="w-3.5 h-3.5" />
          Event trigger
        </div>
        <button
          type="button"
          onClick={onDisable}
          className="p-1 rounded hover:bg-white/[0.06] text-foreground/50 hover:text-foreground transition-colors"
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
          value={selection.eventType ?? ''}
          onValueChange={(v) => onChange({ preset: 'event', eventType: v })}
          placeholder="Pick an event"
        />
      </div>
    </div>
  );
}
