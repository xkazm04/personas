// Icon per Mastermind dimension node — shared by both canvas variants.
import { Activity, Bot, BrainCircuit, Database, FlaskConical, Gauge, KeyRound, Server, ShieldCheck, Wand2, Workflow, type LucideIcon } from 'lucide-react';

import type { DimKey } from './types';

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
