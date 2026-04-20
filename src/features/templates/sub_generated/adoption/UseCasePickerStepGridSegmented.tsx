/**
 * Grid — Style C: Segmented Monochrome.
 *
 * Same layout, different design language:
 *   - Chip row is a single joined segmented control (hairline dividers
 *     between segments, no gaps) — reads as one control, not six.
 *   - Monochrome palette: whites and foreground/opacities only. No hue
 *     until the user focuses an input. Lets the typography do the
 *     work.
 *   - Enabled cards gain a white hairline ring, disabled cards fade
 *     into the background.
 *   - Inputs are underline-only (no border box, no fill) for an
 *     editorial, Apple-settings-like feel.
 *   - Labels over icons: icons present at small size + low opacity to
 *     de-emphasize.
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

export function UseCasePickerStepGridSegmented({
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
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 pt-5 pb-4 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-foreground/70" />
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body-lg text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            Enable the capabilities you want and set how each one is triggered.
          </p>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/55 max-w-2xl mx-auto mt-1">
              {templateGoal}
            </p>
          ) : null}
          <div className="mt-2 typo-body-lg text-foreground/60 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </div>
          {triggerComposition === 'shared' && (
            <p className="mt-1 typo-body-lg text-foreground/60">
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
                className={`rounded-xl p-4 transition-colors ${
                  enabled
                    ? 'bg-white/[0.035] ring-1 ring-white/20'
                    : 'bg-transparent ring-1 ring-white/[0.07] opacity-80'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 border flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-foreground border-foreground'
                        : 'bg-transparent border-foreground/30 hover:border-foreground/55'
                    }`}
                    style={{ borderRadius: 3 }}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-background" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => onToggle(uc.id)} className="text-left w-full">
                      <div
                        className={`text-base font-semibold tracking-tight ${
                          enabled ? 'text-foreground' : 'text-foreground/70'
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
                        className="mt-1 inline-flex items-center gap-1 typo-body-lg text-foreground/60 hover:text-foreground/90 underline-offset-4 hover:underline"
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
                          enabled ? 'text-foreground/70' : 'text-foreground/45'
                        }`}
                      >
                        {uc.description}
                      </p>
                    )}

                    {enabled && (
                      <SegmentedTriggerBlock
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

      <div className="flex-shrink-0 border-t border-white/10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body-lg text-foreground/55">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body-lg font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.templates.adopt_modal.use_cases_continue}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface SegmentedTriggerBlockProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function SegmentedTriggerBlock({ selection, availableEvents, onChange }: SegmentedTriggerBlockProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
      {/* Segmented control — joined chips, hairline dividers */}
      <div className="inline-flex w-full rounded-md border border-white/15 bg-white/[0.02] overflow-hidden divide-x divide-white/10">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-foreground/12 text-foreground'
                  : 'text-foreground/60 hover:text-foreground hover:bg-white/[0.04]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'opacity-80' : 'opacity-40'}`} />
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
            className="w-14 bg-transparent border-0 border-b border-foreground/25 focus:border-foreground focus:outline-none px-1 py-1 typo-body-lg text-foreground text-center tabular-nums"
          />
          <span className="text-foreground/55">:00 local</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="space-y-2">
          <div className="inline-flex w-full rounded-md border border-white/15 bg-white/[0.02] overflow-hidden divide-x divide-white/10">
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
                  className={`flex-1 px-2 py-1.5 typo-body-lg font-medium transition-colors ${
                    isActive
                      ? 'bg-foreground/12 text-foreground'
                      : 'text-foreground/60 hover:text-foreground hover:bg-white/[0.04]'
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 typo-body-lg text-foreground/80">
            <span>at</span>
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
              className="w-14 bg-transparent border-0 border-b border-foreground/25 focus:border-foreground focus:outline-none px-1 py-1 typo-body-lg text-foreground text-center tabular-nums"
            />
            <span className="text-foreground/55">:00 local</span>
          </div>
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
            className="flex-1 max-w-md bg-transparent border-0 border-b border-foreground/25 focus:border-foreground focus:outline-none px-1 py-1 typo-body-lg font-mono text-foreground"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body-lg text-foreground/55">Runs only when you invoke it.</p>
      )}

      {active === 'hourly' && (
        <p className="typo-body-lg text-foreground/55">
          Fires every hour (cron <code className="font-mono">0 * * * *</code>).
        </p>
      )}
    </div>
  );
}
