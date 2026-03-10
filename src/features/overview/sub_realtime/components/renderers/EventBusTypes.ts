import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';

export interface PersonaInfo {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface Props {
  events: RealtimeEvent[];
  personas: PersonaInfo[];
  droppedCount?: number;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

/* Layout constants */
export const ORBIT_R_OUTER = 44;
export const ORBIT_R_INNER = 22;
export const NODE_R = 3.2;
export const CORE_R = 8;
export const TRAIL_DURATION = 1.2;
export const COMET_TAIL_STEPS = 6;
