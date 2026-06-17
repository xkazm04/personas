import {
  Compass, Activity, Radio, Sparkles, FlaskConical, Brain, Puzzle, CalendarClock, GitBranch,
} from 'lucide-react';

// -- Tour icons & colors -----------------------------------------------

export const TOUR_ICONS: Record<string, typeof Compass> = {
  Compass, Activity, Radio, Sparkles, Puzzle, CalendarClock, FlaskConical, Brain, GitBranch,
};

export interface TourColorSet {
  bg: string;
  border: string;
  text: string;
  btnBg: string;
  btnBorder: string;
  btnText: string;
}

const FALLBACK: TourColorSet = { bg: 'bg-violet-500/5', border: 'border-violet-500/15', text: 'text-violet-400', btnBg: 'bg-violet-500/10', btnBorder: 'border-violet-500/25', btnText: 'text-violet-300' };

const COLORS: Record<string, TourColorSet> = {
  violet: FALLBACK,
  blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/15', text: 'text-blue-400', btnBg: 'bg-blue-500/10', btnBorder: 'border-blue-500/25', btnText: 'text-blue-300' },
  teal: { bg: 'bg-teal-500/5', border: 'border-teal-500/15', text: 'text-teal-400', btnBg: 'bg-teal-500/10', btnBorder: 'border-teal-500/25', btnText: 'text-teal-300' },
  amber: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', text: 'text-amber-400', btnBg: 'bg-amber-500/10', btnBorder: 'border-amber-500/25', btnText: 'text-amber-300' },
  emerald: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/15', text: 'text-emerald-400', btnBg: 'bg-emerald-500/10', btnBorder: 'border-emerald-500/25', btnText: 'text-emerald-300' },
  indigo: { bg: 'bg-indigo-500/5', border: 'border-indigo-500/15', text: 'text-indigo-400', btnBg: 'bg-indigo-500/10', btnBorder: 'border-indigo-500/25', btnText: 'text-indigo-300' },
};

export function getColors(k: string): TourColorSet { return COLORS[k] ?? FALLBACK; }
