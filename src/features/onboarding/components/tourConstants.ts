import {
  Key,
  LayoutTemplate,
  Play,
  MessageSquare,
} from 'lucide-react';
import type { TourStepId } from '@/stores/slices/system/tourSlice';

export const STEP_ICONS: Record<TourStepId, typeof Key> = {
  'credentials-catalog': Key,
  'template-gallery': LayoutTemplate,
  'agent-execution': Play,
  'overview-messages': MessageSquare,
};

export const STEP_COLORS: Record<TourStepId, { bg: string; border: string; text: string; glow: string }> = {
  'credentials-catalog': {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    text: 'text-amber-400',
    glow: 'shadow-amber-500/10',
  },
  'template-gallery': {
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/25',
    text: 'text-violet-400',
    glow: 'shadow-violet-500/10',
  },
  'agent-execution': {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    text: 'text-emerald-400',
    glow: 'shadow-emerald-500/10',
  },
  'overview-messages': {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/25',
    text: 'text-blue-400',
    glow: 'shadow-blue-500/10',
  },
};
