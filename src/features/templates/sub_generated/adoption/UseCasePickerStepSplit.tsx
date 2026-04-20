/**
 * Variant B — Split Pane (master-detail).
 *
 * Left: compact list of capabilities with enable toggle + one-line
 * trigger summary. Right: the selected capability's full trigger config
 * + description always visible. The user scans the list, drills into
 * one config at a time, and sees every UC's current trigger status at
 * a glance.
 *
 * Best when the template has many capabilities (6+) or the triggers
 * carry a lot of contextual help (event chaining etc.).
 */
import { useMemo, useState, useEffect } from 'react';
import { Sparkles, Check, ChevronRight, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  PRESETS,
  type TriggerSelection,
  WEEKDAYS,
  describeSelection,
  isManual,
  presetKeyForSelection,
  selectionForPreset,
  clampHour,
  makeTriggerUpdater,
  type UseCasePickerVariantProps,
} from './useCasePickerShared';

export function UseCasePickerStepSplit({
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

  const [detailId, setDetailId] = useState<string | null>(() => useCases[0]?.id ?? null);
  // Keep the detail pane pinned to a valid UC if the list shrinks or the
  // selected UC is disabled by the user.
  useEffect(() => {
    if (detailId && useCases.some((u) => u.id === detailId)) return;
    setDetailId(useCases[0]?.id ?? null);
  }, [useCases, detailId]);

  const selectedUc = useMemo(
    () => useCases.find((u) => u.id === detailId) ?? null,
    [useCases, detailId],
  );

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEvents.map((e) => ({ value: e, label: e })),
    [availableEvents],
  );

  const updateTrigger = useMemo(
    () => makeTriggerUpdater(useCases, triggerComposition, triggerSelections, onTriggerChange),
    [useCases, triggerComposition, triggerSelections, onTriggerChange],
  );

  const getSel = (ucId: string): TriggerSelection => {
    return (
      triggerSelections[ucId] ??
      useCases.find((u) => u.id === ucId)?.defaultSelection ??
      { preset: 'custom', customCron: '' }
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 pt-6 pb-5 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-xl font-semibold text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body-lg text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            Enable the capabilities you want and configure each one's trigger on the right.
          </p>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/60 max-w-2xl mx-auto mt-1">{templateGoal}</p>
          ) : null}
          <div className="mt-3 typo-body-lg text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </div>
          {triggerComposition === 'shared' && (
            <p className="mt-2 typo-body-lg text-primary/70">
              Shared trigger — changes apply to every capability.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full max-w-6xl mx-auto px-6 py-6 grid grid-cols-12 gap-4">
          {/* Master list */}
          <div className="col-span-5 min-h-0 overflow-y-auto rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            <ul className="divide-y divide-white/[0.04]">
              {useCases.map((uc) => {
                const enabled = selectedIds.has(uc.id);
                const isSelected = detailId === uc.id;
                const sel = getSel(uc.id);
                return (
                  <li
                    key={uc.id}
                    className={`relative ${
                      isSelected ? 'bg-primary/[0.08]' : 'hover:bg-white/[0.03]'
                    } transition-colors`}
                  >
                    <button
                      type="button"
                      onClick={() => setDetailId(uc.id)}
                      className="w-full text-left px-4 py-3 flex items-start gap-3"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(uc.id);
                        }}
                        className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          enabled
                            ? 'bg-primary border-primary'
                            : 'bg-transparent border-white/[0.2] hover:border-white/[0.3]'
                        }`}
                        aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                      >
                        {enabled && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-base font-semibold truncate ${
                            enabled ? 'text-foreground' : 'text-foreground/60'
                          }`}
                        >
                          {uc.name}
                        </div>
                        {enabled ? (
                          <div className="typo-body-lg text-foreground/60 mt-0.5 truncate">
                            {describeSelection(sel)}
                          </div>
                        ) : (
                          <div className="typo-body-lg text-foreground/40 mt-0.5">Disabled</div>
                        )}
                      </div>
                      {isSelected && (
                        <ChevronRight className="w-4 h-4 text-primary/70 flex-shrink-0 mt-1" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Detail pane */}
          <div className="col-span-7 min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait">
              {selectedUc ? (
                <motion.div
                  key={selectedUc.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 space-y-4"
                >
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{selectedUc.name}</h3>
                    {selectedUc.capability_summary && (
                      <p className="typo-body-lg text-foreground/80 mt-1 leading-relaxed">
                        {selectedUc.capability_summary}
                      </p>
                    )}
                    {selectedUc.description &&
                      selectedUc.description !== selectedUc.capability_summary && (
                        <p className="typo-body-lg text-foreground/60 mt-2 leading-relaxed">
                          {selectedUc.description}
                        </p>
                      )}
                  </div>

                  {selectedIds.has(selectedUc.id) ? (
                    <SplitTriggerPanel
                      selection={getSel(selectedUc.id)}
                      availableEvents={eventOptions}
                      onChange={(next) => updateTrigger(selectedUc.id, next)}
                    />
                  ) : (
                    <div className="flex items-start gap-2 p-4 rounded-card bg-white/[0.03] border border-white/[0.06] typo-body-lg text-foreground/60">
                      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        This capability is disabled. Enable it in the list on the left to configure
                        its trigger.
                      </span>
                    </div>
                  )}
                </motion.div>
              ) : (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-6 typo-body-lg text-foreground/50 text-center">
                  No capabilities to configure.
                </div>
              )}
            </AnimatePresence>
          </div>
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

interface TriggerPanelProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function SplitTriggerPanel({ selection, availableEvents, onChange }: TriggerPanelProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="space-y-3 pt-3 border-t border-white/[0.06]">
      <div className="typo-body-lg text-foreground/70 font-medium">Trigger</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-card border typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-primary/20 border-primary/40 text-foreground'
                  : 'bg-white/[0.03] border-white/[0.08] text-foreground/70 hover:bg-white/[0.06] hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-card border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
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
              className="w-20 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg focus:outline-none focus:border-primary/30 transition-colors"
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
              className="w-20 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg focus:outline-none focus:border-primary/30 transition-colors"
            />
            <span className="text-foreground/60">:00 local</span>
          </div>
        )}

        {active === 'event' && (
          <div className="space-y-2">
            <div className="typo-body-lg text-foreground/80">Fire when another capability emits…</div>
            <ThemedSelect
              wrapperClassName="max-w-md"
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
              className="flex-1 max-w-md px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body-lg font-mono focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>
        )}

        {active === 'manual' && (
          <p className="typo-body-lg text-foreground/60">
            Runs only when you invoke it. No scheduled or event-based firing.
          </p>
        )}

        {active === 'hourly' && (
          <p className="typo-body-lg text-foreground/60">
            Fires on the hour, every hour (cron <code className="font-mono">0 * * * *</code>).
          </p>
        )}
      </div>
    </div>
  );
}
