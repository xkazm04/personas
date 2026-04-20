/**
 * Combined capability + trigger composition step — first step of the
 * adoption flow. Lets the user enable/disable capabilities and choose
 * how each one is triggered, all on one page. Disabled capabilities are
 * excluded from the downstream questionnaire and matrix; trigger
 * selections are materialized onto the seeded persona's design result
 * so cadence and event chaining match the user's choices.
 *
 * Design principles (2026-04-20 review):
 *   - No technical ids in the UI (uc_foo etc.) — titles only.
 *   - No "event-driven" gating based on the template's default trigger
 *     type. Any capability can be toggled to event-driven via the chip.
 *   - Descriptions collapsed by default behind a "Show details" affordance.
 *   - Minimum text-md typography throughout; no text-xs / text-[10px]
 *     design-token escape hatches.
 *   - Event selector uses the project-wide ThemedSelect component for
 *     consistent styling across the app.
 */
import { useMemo, useState } from 'react';
import { Sparkles, Check, ChevronRight, ChevronDown, Calendar, Clock, Zap, Settings2, Hand } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { TriggerSelection } from './TriggerCompositionStepChips';

export interface UseCaseOption {
  id: string;
  name: string;
  description?: string;
  capability_summary?: string;
  /** Inferred from the template's suggested_trigger at load time. */
  defaultSelection?: TriggerSelection;
}

interface Props {
  templateName?: string;
  templateGoal?: string | null;
  useCases: UseCaseOption[];
  selectedIds: Set<string>;
  /** All events any enabled UC emits — candidates for cross-UC event triggers. */
  availableEvents: string[];
  /** Persona-level trigger composition from the template. Shared mode links all cards. */
  triggerComposition: 'shared' | 'per_use_case';
  /** User's per-UC trigger selections, keyed by UC id. */
  triggerSelections: Record<string, TriggerSelection>;
  onToggle: (id: string) => void;
  onTriggerChange: (selections: Record<string, TriggerSelection>) => void;
  onContinue: () => void;
}

type PresetKey = TriggerSelection['preset'] | 'manual';

interface PresetMeta {
  key: PresetKey;
  label: string;
  icon: typeof Calendar;
}

const PRESETS: PresetMeta[] = [
  { key: 'manual', label: 'Manual', icon: Hand },
  { key: 'hourly', label: 'Hourly', icon: Clock },
  { key: 'daily', label: 'Daily', icon: Calendar },
  { key: 'weekly', label: 'Weekly', icon: Calendar },
  { key: 'event', label: 'Event', icon: Zap },
  { key: 'custom', label: 'Custom cron', icon: Settings2 },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "manual" is a UI-level concept — internally it maps to `preset: "custom"`
 * with an empty customCron. The cron → schedule materializer interprets
 * empty-custom as trigger_type: "manual" and drops the cron field.
 */
function isManual(sel: TriggerSelection | undefined): boolean {
  return sel?.preset === 'custom' && !sel.customCron?.trim();
}

function presetKeyForSelection(sel: TriggerSelection | undefined): PresetKey {
  if (!sel) return 'manual';
  if (isManual(sel)) return 'manual';
  return sel.preset;
}

function selectionForPreset(key: PresetKey, prev: TriggerSelection | undefined): TriggerSelection {
  switch (key) {
    case 'manual':
      return { preset: 'custom', customCron: '' };
    case 'hourly':
      return { preset: 'hourly' };
    case 'daily':
      return { preset: 'daily', hourOfDay: prev?.hourOfDay ?? 9 };
    case 'weekly':
      return { preset: 'weekly', hourOfDay: prev?.hourOfDay ?? 9, weekday: prev?.weekday ?? 1 };
    case 'event':
      return { preset: 'event', eventType: prev?.eventType };
    case 'custom':
      return { preset: 'custom', customCron: prev?.customCron ?? '' };
  }
}

export function UseCasePickerStep({
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
}: Props) {
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

  const updateTrigger = (ucId: string, sel: TriggerSelection) => {
    if (triggerComposition === 'shared') {
      const next: Record<string, TriggerSelection> = {};
      for (const uc of useCases) next[uc.id] = sel;
      onTriggerChange(next);
      return;
    }
    onTriggerChange({ ...triggerSelections, [ucId]: sel });
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 pt-6 pb-5 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            Enable the capabilities you want and set how each one is triggered.
          </p>
          {templateGoal ? (
            <p className="typo-body italic text-foreground/60 max-w-2xl mx-auto mt-1">
              {templateGoal}
            </p>
          ) : null}
          <div className="mt-3 typo-body text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </div>
          {triggerComposition === 'shared' && (
            <p className="mt-2 typo-body text-primary/70">
              This persona fires all capabilities on one shared trigger — changes apply to every card.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-3">
          {useCases.map((uc) => {
            const enabled = selectedIds.has(uc.id);
            const sel = triggerSelections[uc.id] ?? uc.defaultSelection ?? { preset: 'custom', customCron: '' };
            const descExpanded = expandedDescId.has(uc.id);
            const hasDescription = uc.description && uc.description !== uc.capability_summary;
            return (
              <motion.div
                key={uc.id}
                layout
                className={`group relative rounded-2xl border transition-all p-4 ${
                  enabled
                    ? 'bg-primary/[0.07] border-primary/25'
                    : 'bg-white/[0.02] border-white/[0.06]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onToggle(uc.id)}
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
                    <button
                      type="button"
                      onClick={() => onToggle(uc.id)}
                      className="text-left w-full"
                    >
                      <div
                        className={`text-md font-semibold leading-snug ${
                          enabled ? 'text-foreground' : 'text-foreground/80'
                        }`}
                      >
                        {uc.name}
                      </div>
                      {uc.capability_summary && (
                        <p
                          className={`mt-1 typo-body leading-relaxed ${
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
                        className="mt-1 inline-flex items-center gap-1 typo-body text-primary/80 hover:text-primary transition-colors"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${descExpanded ? 'rotate-180' : ''}`}
                        />
                        {descExpanded ? 'Hide details' : 'Show details'}
                      </button>
                    )}
                    {descExpanded && hasDescription && (
                      <p
                        className={`mt-2 typo-body leading-relaxed ${
                          enabled ? 'text-foreground/65' : 'text-foreground/40'
                        }`}
                      >
                        {uc.description}
                      </p>
                    )}

                    {enabled && (
                      <TriggerPanel
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
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-body text-foreground/60">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
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

function TriggerPanel({ selection, availableEvents, onChange }: TriggerPanelProps) {
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border typo-body font-medium transition-colors ${
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
        <div className="flex items-center gap-2 typo-body text-foreground/80">
          <span>at</span>
          <input
            type="number"
            min={0}
            max={23}
            value={selection.hourOfDay ?? 9}
            onChange={(e) =>
              onChange({ ...selection, preset: 'daily', hourOfDay: clampHour(e.target.value) })
            }
            className="w-16 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body focus:outline-none focus:border-primary/30 transition-colors"
          />
          <span className="text-foreground/60">:00 local</span>
        </div>
      )}

      {active === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2 typo-body text-foreground/80">
          <span>on</span>
          {WEEKDAYS.map((d, i) => {
            const isActive = selection.weekday === i;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ ...selection, preset: 'weekly', weekday: i, hourOfDay: selection.hourOfDay ?? 9 })}
                className={`px-2.5 py-1 rounded-card border typo-body transition-colors ${
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
              onChange({ ...selection, preset: 'weekly', hourOfDay: clampHour(e.target.value), weekday: selection.weekday ?? 1 })
            }
            className="w-16 px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body focus:outline-none focus:border-primary/30 transition-colors"
          />
          <span className="text-foreground/60">:00 local</span>
        </div>
      )}

      {active === 'event' && (
        <div className="flex items-center gap-2 typo-body text-foreground/80">
          <span>listen for</span>
          <ThemedSelect
            wrapperClassName="flex-1 max-w-md"
            filterable
            options={availableEvents.length > 0 ? availableEvents : [{ value: '', label: '(no events defined by any capability)' }]}
            value={selection.eventType ?? ''}
            onValueChange={(v) => onChange({ ...selection, preset: 'event', eventType: v })}
            placeholder="Pick an event"
          />
        </div>
      )}

      {active === 'custom' && !isManual(selection) && (
        <div className="flex items-center gap-2 typo-body text-foreground/80">
          <span className="font-mono">cron</span>
          <input
            type="text"
            placeholder="0 9 * * 1"
            value={selection.customCron ?? ''}
            onChange={(e) => onChange({ preset: 'custom', customCron: e.target.value })}
            className="flex-1 max-w-md px-2 py-1.5 rounded-card border border-white/[0.08] bg-white/[0.03] text-foreground typo-body font-mono focus:outline-none focus:border-primary/30 transition-colors"
          />
        </div>
      )}

      {active === 'manual' && (
        <p className="typo-body text-foreground/60">
          Runs only when you invoke it from the agent. No scheduled or event-based firing.
        </p>
      )}

      {active === 'hourly' && (
        <p className="typo-body text-foreground/60">Fires on the hour, every hour (cron <code className="font-mono">0 * * * *</code>).</p>
      )}
    </div>
  );
}

function clampHour(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(23, n));
}
