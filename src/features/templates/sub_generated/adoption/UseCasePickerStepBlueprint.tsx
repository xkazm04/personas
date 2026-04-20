/**
 * Grid — Style C: Blueprint.
 *
 * Same DNA (data-dashboard top bar, 2-col grid, chip row, inline
 * inputs), shifted to a schematic / graph-paper aesthetic:
 *   - Card surface carries a subtle grid-paper pattern (radial dots).
 *   - Borders are hairline (1px, low-opacity), doubled on enabled
 *     cards (outer hairline + inner primary accent ring) to simulate
 *     a drafting frame.
 *   - Accent hue is slate-blue instead of cyan for a calmer,
 *     technical-drawing feel.
 *   - Chips are thin rectangular buttons with a tick-mark underline
 *     when active (no fill), mimicking schematic call-outs.
 *   - Composition badge becomes a stamp-like uppercase slate tag.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Check, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  PRESETS,
  WEEKDAYS,
  isManual,
  presetKeyForSelection,
  selectionForPreset,
  clampHour,
  makeTriggerUpdater,
  type TriggerSelection,
  type UseCasePickerVariantProps,
} from './useCasePickerShared';

const GRID_BG = {
  backgroundImage:
    'radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.08) 1px, transparent 0)',
  backgroundSize: '14px 14px',
};

export function UseCasePickerStepBlueprint({
  templateName,
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
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-500/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-5 h-5 text-slate-300/80 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xl font-semibold text-foreground flex items-center gap-2 flex-wrap">
              <span className="truncate">{templateName ?? t.templates.adopt_modal.use_cases_title}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 typo-body font-mono uppercase tracking-[0.18em] text-slate-200/90 border-y border-slate-400/40">
                <Activity className="w-3 h-3" />
                {triggerComposition === 'shared' ? 'shared trigger' : 'per-UC triggers'}
              </span>
            </div>
            {templateGoal ? (
              <div className="typo-body-lg italic text-foreground/60 mt-1 max-w-2xl">{templateGoal}</div>
            ) : null}
          </div>
        </div>
        <div className="typo-body-lg font-mono text-foreground/55 tabular-nums whitespace-nowrap">
          {selectedCount}/{useCases.length} capabilit{useCases.length === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {triggerComposition === 'shared' && (
        <div className="flex-shrink-0 px-6 py-2 bg-slate-500/[0.05] border-b border-slate-400/20 typo-body-lg text-slate-200/80 font-mono">
          All capabilities fire on the same tick — changing any card applies to all.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3 auto-rows-min">
          {useCases.map((uc, idx) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? { preset: 'custom', customCron: '' };
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            return (
              <motion.div
                key={uc.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                style={GRID_BG}
                className={`rounded-md p-4 flex flex-col gap-3 transition-colors ${
                  enabled
                    ? 'border border-slate-400/40 ring-1 ring-inset ring-slate-300/10 bg-slate-500/[0.05]'
                    : 'border border-slate-500/15 bg-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 border flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-slate-200 border-slate-200'
                        : 'bg-transparent border-slate-400/40 hover:border-slate-300/60'
                    }`}
                    style={{ borderRadius: 2 }}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-background" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => onToggle(uc.id)} className="text-left w-full">
                      <div
                        className={`text-base font-semibold tracking-tight leading-snug ${
                          enabled ? 'text-foreground' : 'text-foreground/70'
                        }`}
                      >
                        {uc.name}
                      </div>
                      {uc.capability_summary && (
                        <div
                          className={`mt-1 typo-body-lg leading-relaxed ${
                            enabled ? 'text-foreground/80' : 'text-foreground/55'
                          }`}
                        >
                          {uc.capability_summary}
                        </div>
                      )}
                    </button>
                    {hasDescription && (
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        className="mt-1 inline-flex items-center gap-1 typo-body-lg text-slate-200/80 hover:text-slate-100 underline-offset-4 hover:underline font-mono"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${descExpanded ? 'rotate-180' : ''}`}
                        />
                        {descExpanded ? 'hide details' : 'show details'}
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
                  <BlueprintTriggerBlock
                    selection={sel}
                    availableEvents={eventOptions}
                    onChange={(next) => updateTrigger(uc.id, next)}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-slate-500/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body-lg text-foreground/55 font-mono">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body-lg font-medium rounded-md bg-slate-200 text-background hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.templates.adopt_modal.use_cases_continue}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface TriggerBlockProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function BlueprintTriggerBlock({ selection, availableEvents, onChange }: TriggerBlockProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 typo-body-lg font-medium font-mono lowercase transition-colors border-b-2 ${
                isActive
                  ? 'border-slate-200 text-slate-100 bg-slate-500/10'
                  : 'border-transparent text-foreground/55 hover:text-foreground hover:border-slate-400/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {active === 'daily' && (
        <div className="flex items-center gap-2 typo-body-lg font-mono">
          <span className="text-foreground/55">at</span>
          <input
            type="number"
            min={0}
            max={23}
            value={selection.hourOfDay ?? 9}
            onChange={(e) =>
              onChange({ ...selection, preset: 'daily', hourOfDay: clampHour(e.target.value) })
            }
            className="w-14 bg-transparent border-0 border-b border-slate-400/40 focus:border-slate-200 focus:outline-none px-1 py-1 text-foreground text-center tabular-nums"
          />
          <span className="text-foreground/55">:00</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="flex items-center gap-2 typo-body-lg font-mono flex-wrap">
          <span className="text-foreground/55">on</span>
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
                className={`px-2 py-0.5 border-b-2 transition-colors ${
                  isActive
                    ? 'border-slate-200 text-slate-100 bg-slate-500/10'
                    : 'border-transparent text-foreground/55 hover:text-foreground hover:border-slate-400/30'
                }`}
              >
                {d}
              </button>
            );
          })}
          <span className="text-foreground/55 ml-1">at</span>
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
            className="w-14 bg-transparent border-0 border-b border-slate-400/40 focus:border-slate-200 focus:outline-none px-1 py-1 text-foreground text-center tabular-nums"
          />
          <span className="text-foreground/55">:00</span>
        </div>
      )}

      {active === 'event' && (
        <div className="flex items-center gap-2 typo-body-lg font-mono">
          <span className="text-foreground/55">listen for</span>
          <ThemedSelect
            wrapperClassName="flex-1 min-w-0 max-w-md"
            filterable
            options={
              availableEvents.length > 0
                ? availableEvents
                : [{ value: '', label: '(no events defined by any capability)' }]
            }
            value={selection.eventType ?? ''}
            onValueChange={(v) => onChange({ ...selection, preset: 'event', eventType: v })}
            placeholder="Pick an event"
          />
        </div>
      )}

      {active === 'custom' && !isManual(selection) && (
        <div className="flex items-center gap-2 typo-body-lg font-mono">
          <span className="text-foreground/55">cron</span>
          <input
            type="text"
            placeholder="0 9 * * 1"
            value={selection.customCron ?? ''}
            onChange={(e) => onChange({ preset: 'custom', customCron: e.target.value })}
            className="flex-1 max-w-md bg-transparent border-0 border-b border-slate-400/40 focus:border-slate-200 focus:outline-none px-1 py-1 text-foreground"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          — invoked on demand.
        </p>
      )}

      {active === 'hourly' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          — cron <span className="text-slate-200">0 * * * *</span>
        </p>
      )}
    </div>
  );
}
