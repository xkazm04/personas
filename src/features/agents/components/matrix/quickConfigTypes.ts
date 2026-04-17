import type { HealthyConnector } from './useHealthyConnectors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Frequency = 'daily' | 'weekly' | 'monthly';

export const DAYS = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
] as const;

export const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export const INPUT_CLS = 'h-9 px-3 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none focus-visible:border-primary/30 transition-colors';

export interface EventSubscription {
  personaId: string;
  personaName: string;
  triggerId: string;
  description: string;
}

export interface QuickConfigState {
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
  selectedConnectors: string[];
  /** Map of connector name -> selected table name for database connectors */
  connectorTables: Record<string, string>;
  /** Event subscriptions from other personas' event_listener triggers */
  selectedEvents: EventSubscription[];
}

export function serializeQuickConfig(state: QuickConfigState): string {
  const parts: string[] = [];

  if (state.frequency) {
    let schedule: string;
    if (state.frequency === 'daily') {
      schedule = `Daily at ${state.time || '09:00'}`;
    } else if (state.frequency === 'weekly') {
      const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d).join(', ');
      schedule = `Weekly on ${dayNames || 'Monday'} at ${state.time || '09:00'}`;
    } else {
      schedule = `Monthly on day ${state.monthDay} at ${state.time || '09:00'}`;
    }
    parts.push(`Schedule: ${schedule}`);
  }

  if (state.selectedConnectors.length > 0) {
    const serviceDescs = state.selectedConnectors.map((name) => {
      const table = state.connectorTables[name];
      return table ? `${name} (table: ${table})` : name;
    });
    parts.push(`Services: ${serviceDescs.join(', ')}`);
  }

  if (state.selectedEvents.length > 0) {
    const eventDescs = state.selectedEvents.map((e) => `${e.description} (from ${e.personaName})`);
    parts.push(`Event triggers: ${eventDescs.join(', ')}`);
  }

  return parts.length > 0 ? `\n---\n${parts.join('\n')}` : '';
}

/** Build human-readable trigger summary for cell preview (schedule + events) */
export function describeTriggerConfig(state: QuickConfigState): string[] {
  const lines: string[] = [];
  if (state.frequency === 'daily') {
    lines.push(`Daily at ${state.time || '09:00'}`);
  } else if (state.frequency === 'weekly') {
    const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d);
    lines.push(`Weekly: ${dayNames.join(', ') || 'Monday'}`);
    lines.push(`At ${state.time || '09:00'}`);
  } else if (state.frequency === 'monthly') {
    lines.push(`Monthly on day ${state.monthDay}`);
    lines.push(`At ${state.time || '09:00'}`);
  }
  for (const ev of state.selectedEvents) {
    lines.push(`On ${ev.description}`);
  }
  return lines;
}

/** Build connector label list for cell preview */
export function describeSelectedConnectors(
  state: QuickConfigState,
  connectors: HealthyConnector[],
): string[] {
  return state.selectedConnectors.map((name) => {
    const c = connectors.find((h) => h.name === name);
    return c?.meta.label ?? name;
  });
}
