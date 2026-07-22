// Icon per Mastermind dimension node — shared by both canvas variants.
import { Activity, Bot, Database, FlaskConical, KeyRound, Server, ShieldCheck, Workflow, type LucideIcon } from 'lucide-react';

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
};
