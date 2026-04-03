import {
  Palette, Key, Sparkles, Activity, MessageSquare, Heart, FlaskConical,
  BarChart3, Radio, Link, Zap, Eye,
} from 'lucide-react';

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

// -- Color scheme by key ------------------------------------------------

interface ColorScheme { bg: string; border: string; text: string; glow: string }

const VIOLET: ColorScheme = { bg: 'bg-violet-500/10', border: 'border-violet-500/25', text: 'text-violet-400', glow: 'shadow-violet-500/10' };
const BLUE: ColorScheme = { bg: 'bg-blue-500/10', border: 'border-blue-500/25', text: 'text-blue-400', glow: 'shadow-blue-500/10' };
const TEAL: ColorScheme = { bg: 'bg-teal-500/10', border: 'border-teal-500/25', text: 'text-teal-400', glow: 'shadow-teal-500/10' };
const INDIGO: ColorScheme = { bg: 'bg-indigo-500/10', border: 'border-indigo-500/25', text: 'text-indigo-400', glow: 'shadow-indigo-500/10' };
const AMBER: ColorScheme = { bg: 'bg-amber-500/10', border: 'border-amber-500/25', text: 'text-amber-400', glow: 'shadow-amber-500/10' };
const EMERALD: ColorScheme = { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-400', glow: 'shadow-emerald-500/10' };

const COLOR_BY_KEY: Record<string, ColorScheme> = {
  violet: VIOLET, indigo: INDIGO, blue: BLUE, teal: TEAL, amber: AMBER, emerald: EMERALD,
};

/** Step-ID → color mapping (for StepProgress which uses per-step colors) */
const STEP_TO_COLOR: Record<string, ColorScheme> = {
  'appearance-setup': VIOLET, 'credentials-intro': VIOLET, 'persona-creation': VIOLET,
  'overview-dashboard': BLUE, 'execution-activity': BLUE, 'messages-tab': BLUE, 'health-monitoring': BLUE, 'lab-arena': BLUE,
  'events-intro': TEAL, 'trigger-types': TEAL, 'event-chaining': TEAL, 'live-stream': TEAL,
};

/** Get colors for a tour by its color key (e.g. "violet", "blue") */
export function getStepColors(key: string): ColorScheme {
  return STEP_TO_COLOR[key] ?? COLOR_BY_KEY[key] ?? VIOLET;
}
