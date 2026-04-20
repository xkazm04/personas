/**
 * Grid — Style A: Terminal.
 *
 * The baseline that tested well, resurrected from the original
 * TriggerCompositionStepChips prototype. Data-dashboard aesthetic:
 * cyan accents, mono-font flourishes for metadata (counts, badge
 * tags), rounded-xl cards on a near-black surface, chip pills with
 * ring-1 highlight when active.
 *
 * Ported to the combined-step contract with the post-review fixes:
 *   - typography at typo-body-lg minimum (no text-[10/11]px escapes)
 *   - no technical ids (uc_*) surfaced — titles only
 *   - no "event-driven" lock badge — every capability can be toggled
 *     to any preset, event included
 *   - raw <select> replaced with the shared ThemedSelect
 *   - UC enable toggle + description "Show details" affordance
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

export function UseCasePickerStepTerminal({
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
      {/* Top bar — persona header + composition badge + capability count */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-5 h-5 text-cyan-300/80 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xl font-semibold text-foreground flex items-center gap-2 flex-wrap">
              <span className="truncate">{templateName ?? t.templates.adopt_modal.use_cases_title}</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 typo-body font-mono uppercase tracking-wide text-cyan-300/80">
                <Activity className="w-3 h-3" />
                {triggerComposition === 'shared' ? 'shared trigger' : 'per-UC triggers'}
              </span>
            </div>
            {templateGoal ? (
              <div className="typo-body-lg italic text-foreground/60 mt-1 max-w-2xl">{templateGoal}</div>
            ) : null}
          </div>
        </div>
        <div className="typo-body-lg font-mono text-foreground/60 tabular-nums whitespace-nowrap">
          {selectedCount}/{useCases.length} capabilit{useCases.length === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {/* Shared-mode notice strip */}
      {triggerComposition === 'shared' && (
        <div className="flex-shrink-0 px-6 py-2 bg-cyan-500/[0.04] border-b border-cyan-500/[0.1] typo-body-lg text-cyan-300/80">
          All capabilities fire on the same tick. Changing any card applies to all.
        </div>
      )}

      {/* Per-UC grid */}
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
                className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
                  enabled
                    ? 'border-cyan-500/25 bg-cyan-500/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-cyan-400 border-cyan-400'
                        : 'bg-transparent border-white/20 hover:border-white/35'
                    }`}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-background" strokeWidth={3} />}
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
                        className="mt-1 inline-flex items-center gap-1 typo-body-lg text-cyan-300/80 hover:text-cyan-200"
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
                  <TerminalTriggerBlock
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

      <div className="flex-shrink-0 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body-lg text-foreground/55">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body-lg font-medium rounded-modal bg-cyan-500/90 text-background hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

function TerminalTriggerBlock({ selection, availableEvents, onChange }: TriggerBlockProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/40'
                  : 'bg-white/[0.04] text-foreground/60 hover:bg-white/[0.08] hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {active === 'daily' && (
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
            className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground focus:outline-none focus:border-cyan-500/50 text-center"
          />
          <span className="text-foreground/55 font-mono">:00</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="flex items-center gap-2 typo-body-lg flex-wrap">
          <span className="text-foreground/55 font-mono">on</span>
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
                className={`rounded-md px-2 py-0.5 font-mono transition-colors ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/40'
                    : 'bg-white/[0.04] text-foreground/60 hover:text-foreground'
                }`}
              >
                {d}
              </button>
            );
          })}
          <span className="text-foreground/55 font-mono ml-1">at</span>
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
            className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground focus:outline-none focus:border-cyan-500/50 text-center"
          />
          <span className="text-foreground/55 font-mono">:00</span>
        </div>
      )}

      {active === 'event' && (
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
            onValueChange={(v) => onChange({ ...selection, preset: 'event', eventType: v })}
            placeholder="Pick an event"
          />
        </div>
      )}

      {active === 'custom' && !isManual(selection) && (
        <div className="flex items-center gap-2 typo-body-lg">
          <span className="text-foreground/55 font-mono">cron</span>
          <input
            type="text"
            placeholder="0 9 * * 1"
            value={selection.customCron ?? ''}
            onChange={(e) => onChange({ preset: 'custom', customCron: e.target.value })}
            className="flex-1 max-w-md rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          ▸ Invoked on demand. No schedule, no event listener.
        </p>
      )}

      {active === 'hourly' && (
        <p className="typo-body-lg text-foreground/55 font-mono">
          ▸ cron <span className="text-foreground/80">0 * * * *</span>
        </p>
      )}
    </div>
  );
}
