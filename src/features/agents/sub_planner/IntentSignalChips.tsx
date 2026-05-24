/**
 * Goal-to-Plan — live intent chips.
 *
 * Renders a compact, read-only strip of chips inferred from the goal text as
 * the user types — a persona chip, one per detected service, and
 * schedule/trigger/web chips when those signals are present. It's the
 * instant teaser that precedes the full "Preview plan"; it reuses the
 * planner's category labels so it reads as the same system. Nothing here
 * executes or persists.
 */
import { Bot, Plug, Clock, Zap, Globe, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { inferIntentSignals } from './intentSignals';

function Chip({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-label ${tone}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function IntentSignalChips({ text }: { text: string }) {
  const { t } = useTranslation();
  const s = inferIntentSignals(text);
  if (!s.hasPersona) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="planner-intent-chips">
      <Chip icon={Bot} label={t.planner.category_persona} tone="bg-violet-500/10 text-violet-300" />
      {s.services.map((svc) => (
        <Chip key={svc} icon={Plug} label={svc} tone="bg-blue-500/10 text-blue-300" />
      ))}
      {s.monitorsWeb && <Chip icon={Globe} label={t.planner.category_action} tone="bg-cyan-500/10 text-cyan-300" />}
      {s.hasSchedule && <Chip icon={Clock} label={t.planner.category_schedule} tone="bg-emerald-500/10 text-emerald-300" />}
      {s.hasTrigger && <Chip icon={Zap} label={t.planner.category_trigger} tone="bg-amber-500/10 text-amber-300" />}
    </div>
  );
}
