// The sensor identity every findings surface shares: which sensor raised an
// idea, its glyph, its label, and its hue. Split out of FindingBadge.tsx so the
// badge, the scoreboard, the rules panel and the Backlog table resolve an origin
// the same way (the same sensor must never read as two different things).
import { Activity, AlertTriangle, BrainCircuit, Compass, DollarSign, ClipboardCheck, FileClock, FlaskConical, Library, MoonStar, Target } from 'lucide-react';

import type { FindingOrigin } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';

// style-deviation: each sensor keeps its own hue. This is categorical identity (eleven sensors, read at a glance in the Backlog table and rail), not a status or a role: no status/role token says "which sensor", and mapping them onto the four statuses would make a KPI finding read as success and a cost finding read as a warning verdict. The raw steps get light-theme parity from globals.css' [data-theme^="light"] repair selectors. A categorical palette token set is the missing primitive (Gate 2 retro).
const ORIGIN_META: Record<
  FindingOrigin,
  { labelKey: keyof Translations['plugins']['dev_triage']; icon: typeof Activity; tw: string }
> = {
  standards_finding: {
    labelKey: 'origin_standards_finding',
    icon: ClipboardCheck,
    tw: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  },
  passport_gap: {
    labelKey: 'origin_passport_gap',
    icon: Target,
    tw: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
  },
  llm_cost: {
    labelKey: 'origin_llm_cost',
    icon: DollarSign,
    tw: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  },
  sentry_spike: {
    labelKey: 'origin_sentry_spike',
    icon: AlertTriangle,
    tw: 'bg-red-500/10 text-red-300 border-red-500/25',
  },
  kpi_offtrack: {
    labelKey: 'origin_kpi_offtrack',
    icon: Activity,
    tw: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  },
  skill_dormant: {
    labelKey: 'origin_skill_dormant',
    icon: MoonStar,
    tw: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25',
  },
  doc_rot: {
    labelKey: 'origin_doc_rot',
    icon: FileClock,
    tw: 'bg-orange-500/10 text-orange-300 border-orange-500/25',
  },
  kpi_sim: {
    labelKey: 'origin_kpi_sim',
    icon: FlaskConical,
    tw: 'bg-teal-500/10 text-teal-300 border-teal-500/25',
  },
  memory_disputed: {
    labelKey: 'origin_memory_disputed',
    icon: BrainCircuit,
    tw: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  },
  // Not a measurement sensor: the Workspace Knowledge Center materializing an
  // adopted practice (or a pitfall to fix) as one backlog item per member repo.
  // Missing here through three phases, which is why those rows rendered a bare
  // title with no provenance at all.
  workspace_practice: {
    labelKey: 'origin_workspace_practice',
    icon: Library,
    tw: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25',
  },
  // The scan-sweep skill's findings + deep-scan escalations, arriving through
  // the memory-outbox door rather than an in-app sensor.
  scan_sweep: {
    labelKey: 'origin_scan_sweep',
    icon: Compass,
    tw: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
  },
};

/**
 * Resolve an origin slug to its translated label. A hook (not a pure function)
 * because the label lives in the i18n catalog — `originMeta()` still returns
 * the icon + palette for callers that only need the visual identity.
 */
export function useOriginLabel(): (origin: string) => string {
  const { t } = useTranslation();
  return (origin: string) => {
    const meta = originMeta(origin);
    return meta ? t.plugins.dev_triage[meta.labelKey] : origin;
  };
}

export function originMeta(origin: string) {
  return ORIGIN_META[origin as FindingOrigin];
}
