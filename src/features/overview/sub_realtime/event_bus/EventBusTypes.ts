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
