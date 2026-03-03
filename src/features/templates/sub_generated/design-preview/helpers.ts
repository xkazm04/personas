import type { LucideIcon } from 'lucide-react';
import { Hash, Send, Mail, Bell } from 'lucide-react';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META } from '@/lib/utils/triggerConstants';

export function triggerIconMeta(type: SuggestedTrigger['trigger_type']): { Icon: LucideIcon; color: string } {
  const meta = TRIGGER_TYPE_META[type] || DEFAULT_TRIGGER_META;
  return { Icon: meta.Icon, color: meta.color };
}

export function channelIconMeta(type: string): { Icon: LucideIcon; color: string } {
  switch (type) {
    case 'slack':
      return { Icon: Hash, color: 'text-blue-400' };
    case 'telegram':
      return { Icon: Send, color: 'text-blue-400' };
    case 'email':
      return { Icon: Mail, color: 'text-blue-400' };
    default:
      return { Icon: Bell, color: 'text-blue-400' };
  }
}

export const SECTION_LABEL = 'text-sm font-semibold uppercase tracking-wider text-muted-foreground/90 flex items-center gap-2';
