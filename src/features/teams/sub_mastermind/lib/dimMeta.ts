// Icon per Mastermind dimension node — shared by both canvas variants.
import { Activity, Bot, BrainCircuit, Database, FlaskConical, Gauge, KeyRound, Server, ShieldCheck, Wand2, Workflow, type LucideIcon } from 'lucide-react';

import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';

import type { DimKey, DimNode } from './types';

/** Brand mark for a dimension's identified tool (Supabase, Sentry, GitHub…) —
 *  same resolver the Passport wall uses. Null → fall back to the generic icon. */
export const dimBrand = (node: DimNode) => (node.detail ? resolveTechIcon(node.detail) : null);

export const DIM_ICON: Record<DimKey, LucideIcon> = {
  db: Database,
  monitoring: Activity,
  ci: Workflow,
  tests: FlaskConical,
  security: ShieldCheck,
  hosting: Server,
  auth: KeyRound,
  agents: Bot,
  skills: Wand2,
  llm: BrainCircuit,
  kpi: Gauge,
};
