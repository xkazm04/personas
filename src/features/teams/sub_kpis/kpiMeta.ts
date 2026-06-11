// Display metadata for KPI enum tokens — the i18n'd, icon-carrying layer that
// keeps raw tokens ('technical', 'codebase', 'weekly') out of the UI entirely
// (P5 acceptance: zero enum tokens visible).
import {
  Activity,
  CalendarClock,
  CalendarDays,
  Cable,
  FlaskConical,
  Gem,
  Hand,
  ShieldCheck,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { Translations } from '@/i18n/generated/types';

export interface KpiTokenMeta {
  icon: LucideIcon;
  label: (t: Translations) => string;
}

export const CATEGORY_META: Record<string, KpiTokenMeta> = {
  technical: { icon: Wrench, label: (t) => t.kpis.category_technical },
  quality: { icon: ShieldCheck, label: (t) => t.kpis.category_quality },
  traffic: { icon: Users, label: (t) => t.kpis.category_traffic },
  value: { icon: Gem, label: (t) => t.kpis.category_value },
};

export const KIND_META: Record<string, KpiTokenMeta> = {
  codebase: { icon: FlaskConical, label: (t) => t.kpis.kind_codebase },
  derived: { icon: Activity, label: (t) => t.kpis.kind_derived },
  connector: { icon: Cable, label: (t) => t.kpis.kind_connector },
  manual: { icon: Hand, label: (t) => t.kpis.kind_manual },
};

export const CADENCE_META: Record<string, KpiTokenMeta> = {
  daily: { icon: CalendarDays, label: (t) => t.kpis.cadence_daily },
  weekly: { icon: CalendarClock, label: (t) => t.kpis.cadence_weekly },
  manual: { icon: Hand, label: (t) => t.kpis.cadence_manual },
};

export const FALLBACK_META: KpiTokenMeta = {
  icon: TrendingUp,
  label: () => '',
};

export function categoryMeta(category: string): KpiTokenMeta {
  return CATEGORY_META[category] ?? FALLBACK_META;
}
export function kindMeta(kind: string): KpiTokenMeta {
  return KIND_META[kind] ?? FALLBACK_META;
}
export function cadenceMeta(cadence: string): KpiTokenMeta {
  return CADENCE_META[cadence] ?? FALLBACK_META;
}
