/**
 * Grid — Style A: Outline / Neutral.
 *
 * The foundation that tested well. 2-column tile grid, every
 * capability's chips + contextual inputs visible inline. Aesthetic is
 * utilitarian: subtle borders, minimal hue, primary-tinted surface when
 * enabled, rounded-card chips. Default app look.
 */
import { useMemo, useState } from 'react';
import { Sparkles, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
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

export function UseCasePickerStepGridOutline({
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
  const { t, tx } = useTranslation();
  const selectedCount = useCases.filter((u) => selectedIds.has(u.id)).length;
  const canContinue = selectedCount > 0;

  const [expandedDescId, setExpandedDescId] = useState<Set<string>>(new Set());
  const toggleDesc = (id: string) => {
    setExpandedDescId((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 pt-5 pb-4 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-xl font-semibold text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body-lg text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            Enable the capabilities you want and set how each one is triggered.
          </p>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/60 max-w-2xl mx-auto mt-1">
              {templateGoal}
            </p>
          ) : null}
          <div className="mt-2 typo-body-lg text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </div>
          {triggerComposition === 'shared' && (
            <p className="mt-1 typo-body-lg text-primary/70">
              Shared trigger — changes apply to every card.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {useCases.map((uc) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? { preset: 'custom', customCron: '' };
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            return (
              <motion.div
                key={uc.id}
                layout
                className={`rounded-2xl border p-4 transition-colors ${
                  enabled
                    ? 'bg-primary/[0.06] border-primary/25'
                    : 'bg-white/[0.02] border-white/[0.06]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-primary border-primary'
                        : 'bg-transparent border-white/[0.2] hover:border-white/[0.3]'
                    }`}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => onToggle(uc.id)} className="text-left w-full">
                      <div
                        className={`text-base font-semibold leading-snug ${
                          enabled ? 'text-foreground' : 'text-foreground/75'
                        }`}
                      >
                        {uc.name}
                      </div>
                      {uc.capability_summary && (
                        <p
                          className={`mt-1 typo-body-lg leading-relaxed ${
                            enabled ? 'text-foreground/80' : 'text-foreground/50'
                          }`}
                        >
                          {uc.capability_summary}
                        </p>
                      )}
                    </button>
                    {hasDescription && (
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        className="mt-1 inline-flex items-center gap-1 typo-body-lg text-primary/80 hover:text-primary"
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

                    {enabled && (
                      <TriggerBlock
                        selection={sel}
                        availableEvents={eventOptions}
                        onChange={(next) => updateTrigger(uc.id, next)}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body-lg text-foreground/60">
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

interface TriggerBlockProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function TriggerBlock({ selection, availableEvents, onChange }: TriggerBlockProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-primary/20 border-primary/40 text-foreground'
                  : 'bg-white/[0.03] border-white/[0.08] text-foreground/70 hover:bg-white/[0.06] hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {active === 'daily' && (
        <div className="flex items-center gap-2 typo-body-lg text-foreground/80">
          <span>at</span>
          <input
            type="number"
            min={0}
            max={23}
            value={selection.hourOfDay ?? 9}
            onChange={(e) =>
              onChange({ ...selection, preset: 'daily', hourOfDay: clampHour(e.target.value) })
            }
            className="w-16 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg focus:outline-none focus:border-primary/30"
          />
          <span className="text-foreground/60">:00 local</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2 typo-body-lg text-foreground/80">
          <span>on</span>
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
                className={`px-2.5 py-1 rounded-card border typo-body-lg transition-colors ${
                  isActive
                    ? 'bg-primary/20 border-primary/40 text-foreground'
                    : 'bg-white/[0.03] border-white/[0.08] text-foreground/70 hover:bg-white/[0.06]'
                }`}
              >
                {d}
              </button>
            );
          })}
          <span className="ml-1">at</span>
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
            className="w-16 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg focus:outline-none focus:border-primary/30"
          />
          <span className="text-foreground/60">:00 local</span>
        </div>
      )}

      {active === 'event' && (
        <div className="flex items-center gap-2 typo-body-lg text-foreground/80">
          <span>listen for</span>
          <ThemedSelect
            wrapperClassName="flex-1 max-w-md"
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
        <div className="flex items-center gap-2 typo-body-lg text-foreground/80">
          <span className="font-mono">cron</span>
          <input
            type="text"
            placeholder="0 9 * * 1"
            value={selection.customCron ?? ''}
            onChange={(e) => onChange({ preset: 'custom', customCron: e.target.value })}
            className="flex-1 max-w-md px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg font-mono focus:outline-none focus:border-primary/30"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body-lg text-foreground/60">
          Runs only when you invoke it from the agent.
        </p>
      )}

      {active === 'hourly' && (
        <p className="typo-body-lg text-foreground/60">
          Fires every hour (cron <code className="font-mono">0 * * * *</code>).
        </p>
      )}
    </div>
  );
}
