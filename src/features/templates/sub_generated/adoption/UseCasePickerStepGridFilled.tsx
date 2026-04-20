/**
 * Grid — Style B: Filled Accent.
 *
 * Same 2-column tile grid, same chip set, same props contract. Visual
 * language is bolder:
 *   - Pill chips (rounded-full) with accent colors per preset family
 *     (scheduled = sky, event = violet, manual = slate).
 *   - Enabled cards carry a soft accent glow + gradient surface so
 *     they clearly pop against disabled ones.
 *   - Toggle chevron becomes a filled accent dot; checkmark remains.
 *   - Contextual inputs sit in a lightly-tinted callout block so they
 *     feel like a sub-section, not inline text.
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
  type PresetKey,
  type TriggerSelection,
  type UseCasePickerVariantProps,
} from './useCasePickerShared';

/**
 * Preset-family colors. Scheduled family (hourly/daily/weekly/custom)
 * shares one hue so the eye reads them as one category; event stands
 * apart in violet; manual deliberately low-key in slate.
 */
const ACCENT_FOR_PRESET: Record<PresetKey, { active: string; hover: string; icon: string }> = {
  manual: {
    active: 'bg-slate-500/20 border-slate-400/50 text-slate-100',
    hover: 'hover:bg-slate-500/10',
    icon: 'text-slate-300',
  },
  hourly: {
    active: 'bg-sky-500/20 border-sky-400/50 text-sky-100',
    hover: 'hover:bg-sky-500/10',
    icon: 'text-sky-300',
  },
  daily: {
    active: 'bg-sky-500/20 border-sky-400/50 text-sky-100',
    hover: 'hover:bg-sky-500/10',
    icon: 'text-sky-300',
  },
  weekly: {
    active: 'bg-sky-500/20 border-sky-400/50 text-sky-100',
    hover: 'hover:bg-sky-500/10',
    icon: 'text-sky-300',
  },
  event: {
    active: 'bg-violet-500/20 border-violet-400/50 text-violet-100',
    hover: 'hover:bg-violet-500/10',
    icon: 'text-violet-300',
  },
  custom: {
    active: 'bg-sky-500/20 border-sky-400/50 text-sky-100',
    hover: 'hover:bg-sky-500/10',
    icon: 'text-sky-300',
  },
};

export function UseCasePickerStepGridFilled({
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
            <Sparkles className="w-5 h-5 text-violet-300" />
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
            <p className="mt-1 typo-body-lg text-violet-300/80">
              Shared trigger — changes apply to every card.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {useCases.map((uc) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? { preset: 'custom', customCron: '' };
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            return (
              <motion.div
                key={uc.id}
                layout
                className={`relative rounded-2xl border p-4 transition-all overflow-hidden ${
                  enabled
                    ? 'border-violet-400/30 bg-gradient-to-br from-violet-500/[0.08] via-white/[0.02] to-sky-500/[0.06] shadow-[0_0_32px_-16px_rgba(139,92,246,0.35)]'
                    : 'border-white/[0.06] bg-white/[0.015]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                      enabled
                        ? 'bg-violet-400 border-violet-400'
                        : 'bg-transparent border-white/20 hover:border-white/35'
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
                        className="mt-1 inline-flex items-center gap-1 typo-body-lg text-violet-300/80 hover:text-violet-200"
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
                      <FilledTriggerBlock
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
            className="flex items-center gap-2 px-6 py-2 typo-body-lg font-medium rounded-modal bg-gradient-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-400 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_-12px_rgba(139,92,246,0.6)] transition-all"
          >
            {t.templates.adopt_modal.use_cases_continue}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface FilledTriggerBlockProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function FilledTriggerBlock({ selection, availableEvents, onChange }: FilledTriggerBlockProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="mt-4 rounded-xl bg-white/[0.025] border border-white/[0.06] p-3 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          const style = ACCENT_FOR_PRESET[p.key];
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border typo-body-lg font-medium transition-colors ${
                isActive
                  ? style.active
                  : `bg-white/[0.03] border-white/[0.08] text-foreground/70 ${style.hover} hover:text-foreground`
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? '' : style.icon}`} />
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
            className="w-16 px-2 py-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 text-foreground typo-body-lg focus:outline-none focus:border-sky-300/60 text-center"
          />
          <span className="text-foreground/60">:00 local</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="flex flex-wrap items-center gap-1.5 typo-body-lg text-foreground/80">
          <span className="mr-1">on</span>
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
                className={`w-10 py-1 rounded-full border typo-body-lg transition-colors ${
                  isActive
                    ? 'bg-sky-500/20 border-sky-400/50 text-sky-100'
                    : 'bg-white/[0.03] border-white/[0.08] text-foreground/70 hover:bg-sky-500/10'
                }`}
              >
                {d}
              </button>
            );
          })}
          <span className="ml-2">at</span>
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
            className="w-16 px-2 py-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 text-foreground typo-body-lg focus:outline-none focus:border-sky-300/60 text-center"
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
            className="flex-1 max-w-md px-2 py-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 text-foreground typo-body-lg font-mono focus:outline-none focus:border-sky-300/60"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body-lg text-slate-300/80">Runs only when you invoke it.</p>
      )}

      {active === 'hourly' && (
        <p className="typo-body-lg text-sky-300/80">
          Fires every hour (cron <code className="font-mono">0 * * * *</code>).
        </p>
      )}
    </div>
  );
}
