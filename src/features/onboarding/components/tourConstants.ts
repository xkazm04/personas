import {
  Palette, Key, Sparkles, Activity, MessageSquare, Heart, FlaskConical,
  BarChart3, Radio, Link, Zap, Eye,
} from 'lucide-react';
import {
  getTourSurface,
  type TourSurface,
  type TourSurfaceKey,
} from '@/lib/design/tourSurfaces';

// -- Per-step icon map (all tours) ---------------------------------------

const ICON_MAP: Record<string, typeof Key> = {
  'appearance-setup': Palette,
  'credentials-intro': Key,
  'persona-creation': Sparkles,
  'overview-dashboard': BarChart3,
  'execution-activity': Activity,
  'messages-tab': MessageSquare,
  'health-monitoring': Heart,
  'lab-arena': FlaskConical,
  'events-intro': Zap,
  'trigger-types': Radio,
  'event-chaining': Link,
  'live-stream': Eye,
};

export function getStepIcon(stepId: string): typeof Key {
  return ICON_MAP[stepId] ?? Sparkles;
}

// -- Step / tour → surface key mapping ----------------------------------

/** Step-ID → surface key (StepProgress renders each step in its tour's color). */
const STEP_TO_SURFACE: Record<string, TourSurfaceKey> = {
  'appearance-setup': 'violet', 'credentials-intro': 'violet', 'persona-creation': 'violet',
  'overview-dashboard': 'blue', 'execution-activity': 'blue', 'messages-tab': 'blue', 'health-monitoring': 'blue', 'lab-arena': 'blue',
  'events-intro': 'teal', 'trigger-types': 'teal', 'event-chaining': 'teal', 'live-stream': 'teal',
};

/**
 * Resolve a tour surface from either a step id (StepProgress) or a tour color
 * key (GuidedTour / TourPanelBody). Falls back to the default violet surface.
 */
export function getStepColors(key: string): TourSurface {
  return getTourSurface(STEP_TO_SURFACE[key] ?? key);
}
