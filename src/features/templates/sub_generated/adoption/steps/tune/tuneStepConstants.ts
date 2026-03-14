import { Clock, Webhook, MousePointerClick, Radio, Activity } from 'lucide-react';
import type { SuggestedTrigger } from '@/lib/types/designTypes';

// -- Shared styles -----------------------------------------

export const inputClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors';
export const labelClass = 'block text-sm font-medium text-foreground/80';
export const descClass = 'text-sm text-muted-foreground/50 mt-0.5';
export const fieldClass = 'space-y-1';
export const cardClass = 'rounded-xl border border-primary/10 bg-secondary/20 p-4';

// -- Trigger type icon map ---------------------------------

export const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};
