/**
 * Variant C — Stack Accordion.
 *
 * Vertical stack of capability rows. Each row collapses to a compact
 * row (toggle + title + trigger summary badge) and expands in place to
 * reveal the full trigger panel + description. At most one row expanded
 * at a time — a keyboard-friendly progressive-disclosure pattern.
 *
 * At the top: a sticky composition summary strip showing how many UCs
 * are manual / scheduled / event-driven, plus the composition-mode
 * badge. Lets the user see the overall shape of the persona at a
 * glance without losing the list density.
 *
 * Best when the user wants a lot of context per UC (long descriptions)
 * and the list is short-to-medium (2-8 capabilities).
 */
import { useMemo, useState } from 'react';
import { Sparkles, Check, ChevronRight, ChevronDown, Hand, Clock, Zap } from 'lucide-react';
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

export function UseCasePickerStepStack({
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

  // Start with the first enabled UC expanded so the user sees real
  // controls immediately; they can collapse it or pick another.
  const [openId, setOpenId] = useState<string | null>(() => {
    return useCases.find((u) => selectedIds.has(u.id))?.id ?? useCases[0]?.id ?? null;
  });

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

  // Composition summary — counts by trigger family across enabled UCs.
  const summary = useMemo(() => {
    let manual = 0;
    let scheduled = 0;
    let event = 0;
    for (const uc of useCases) {
      if (!selectedIds.has(uc.id)) continue;
      const sel = triggerSelections[uc.id] ?? uc.defaultSelection;
      const key = presetKeyForSelection(sel);
      if (key === 'manual') manual++;
      else if (key === 'event') event++;
      else scheduled++;
    }
    return { manual, scheduled, event };
  }, [useCases, selectedIds, triggerSelections]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 pt-6 pb-4 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-xl font-semibold text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body-lg text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            Click a row to configure its trigger. Changes apply the moment you make them.
          </p>
          {templateGoal ? (
            <p className="typo-body-lg italic text-foreground/60 max-w-2xl mx-auto mt-1">
              {templateGoal}
            </p>
          ) : null}
        </div>

        {/* Composition summary strip */}
        <div className="max-w-4xl mx-auto px-6 pb-4 flex flex-wrap items-center justify-center gap-3 typo-body-lg">
          <span className="text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </span>
          <span className="text-foreground/30">·</span>
          <SummaryBadge icon={Clock} label="scheduled" count={summary.scheduled} />
          <SummaryBadge icon={Zap} label="event-driven" count={summary.event} />
          <SummaryBadge icon={Hand} label="manual" count={summary.manual} />
          {triggerComposition === 'shared' && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="typo-body-lg text-primary/70">Shared trigger</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-2">
          {useCases.map((uc) => {
            const enabled = selectedIds.has(uc.id);
            const open = openId === uc.id;
            const sel = getSel(uc.id);
            return (
              <div
                key={uc.id}
                className={`rounded-2xl border transition-colors ${
                  open
                    ? 'border-primary/30 bg-primary/[0.05]'
                    : enabled
                      ? 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                      : 'border-white/[0.04] bg-white/[0.01]'
                }`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
                    className={`flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                      enabled
                        ? 'bg-primary border-primary'
                        : 'bg-transparent border-white/[0.2] hover:border-white/[0.3]'
                    }`}
                    aria-label={enabled ? 'Disable capability' : 'Enable capability'}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : uc.id)}
                    className="flex-1 min-w-0 flex items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <div
                        className={`text-base font-semibold truncate ${
                          enabled ? 'text-foreground' : 'text-foreground/60'
                        }`}
                      >
                        {uc.name}
                      </div>
                      {enabled ? (
                        <div className="typo-body-lg text-foreground/55 truncate">
                          {describeSelection(sel)}
                        </div>
                      ) : (
                        <div className="typo-body-lg text-foreground/40">Disabled</div>
                      )}
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-foreground/50 flex-shrink-0 transition-transform ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-1 border-t border-white/[0.06] space-y-3">
                        {uc.capability_summary && (
                          <p className="typo-body-lg text-foreground/75 leading-relaxed">
                            {uc.capability_summary}
                          </p>
                        )}
                        {uc.description && uc.description !== uc.capability_summary && (
                          <p className="typo-body-lg text-foreground/55 leading-relaxed">
                            {uc.description}
                          </p>
                        )}
                        {enabled ? (
                          <StackTriggerPanel
                            selection={sel}
                            availableEvents={eventOptions}
                            onChange={(next) => updateTrigger(uc.id, next)}
                          />
                        ) : (
                          <p className="typo-body-lg text-foreground/60 italic">
                            Enable this capability to configure its trigger.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
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

interface SummaryBadgeProps {
  icon: typeof Clock;
  label: string;
  count: number;
}

function SummaryBadge({ icon: Icon, label, count }: SummaryBadgeProps) {
  const muted = count === 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 typo-body-lg ${
        muted ? 'text-foreground/35' : 'text-foreground/75'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="tabular-nums">{count}</span>
      <span>{label}</span>
    </span>
  );
}

interface TriggerPanelProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  onChange: (next: TriggerSelection) => void;
}

function StackTriggerPanel({ selection, availableEvents, onChange }: TriggerPanelProps) {
  const active = presetKeyForSelection(selection);
  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForPreset(p.key, selection))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border typo-body-lg font-medium transition-colors ${
                isActive
                  ? 'bg-primary/25 border-primary/50 text-foreground'
                  : 'bg-white/[0.04] border-white/[0.08] text-foreground/70 hover:bg-white/[0.08] hover:text-foreground'
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
                className={`px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
                  isActive
                    ? 'bg-primary/25 border-primary/50 text-foreground'
                    : 'bg-white/[0.04] border-white/[0.08] text-foreground/70 hover:bg-white/[0.08]'
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
        <div className="space-y-1.5">
          <span className="typo-body-lg text-foreground/80">Fire when another capability emits…</span>
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
  );
}
