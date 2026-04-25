import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/* ------------------------------------------------------------------ *
 *  TwinHeaderBand
 *  Unified hero band used across every Twin sub-page. A gradient
 *  backdrop, an iconographic sigil with optional halo, eyebrow + title
 *  + subtitle stack, an optional KPI pill, and an actions slot.
 *  Each page provides its own decorative SVG via the `decoration` prop.
 * ------------------------------------------------------------------ */

export type TwinAccent = 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'indigo';

interface AccentTokens {
  fromBg: string;
  toBg: string;
  iconBg: string;
  iconBorder: string;
  iconText: string;
  eyebrow: string;
}

const ACCENTS: Record<TwinAccent, AccentTokens> = {
  violet: {
    fromBg: 'from-violet-500/15',
    toBg: 'via-fuchsia-500/8',
    iconBg: 'bg-violet-500/20',
    iconBorder: 'border-violet-400/40',
    iconText: 'text-violet-300',
    eyebrow: 'text-violet-300/80',
  },
  cyan: {
    fromBg: 'from-cyan-500/15',
    toBg: 'via-sky-500/8',
    iconBg: 'bg-cyan-500/20',
    iconBorder: 'border-cyan-400/40',
    iconText: 'text-cyan-300',
    eyebrow: 'text-cyan-300/80',
  },
  emerald: {
    fromBg: 'from-emerald-500/15',
    toBg: 'via-teal-500/8',
    iconBg: 'bg-emerald-500/20',
    iconBorder: 'border-emerald-400/40',
    iconText: 'text-emerald-300',
    eyebrow: 'text-emerald-300/80',
  },
  amber: {
    fromBg: 'from-amber-500/15',
    toBg: 'via-orange-500/8',
    iconBg: 'bg-amber-500/20',
    iconBorder: 'border-amber-400/40',
    iconText: 'text-amber-300',
    eyebrow: 'text-amber-300/80',
  },
  rose: {
    fromBg: 'from-rose-500/15',
    toBg: 'via-pink-500/8',
    iconBg: 'bg-rose-500/20',
    iconBorder: 'border-rose-400/40',
    iconText: 'text-rose-300',
    eyebrow: 'text-rose-300/80',
  },
  indigo: {
    fromBg: 'from-indigo-500/15',
    toBg: 'via-violet-500/8',
    iconBg: 'bg-indigo-500/20',
    iconBorder: 'border-indigo-400/40',
    iconText: 'text-indigo-300',
    eyebrow: 'text-indigo-300/80',
  },
};

interface TwinHeaderBandProps {
  /** Lucide icon component (rendered at 5x5) */
  icon: ReactNode;
  /** Small uppercase eyebrow above the title */
  eyebrow: string;
  /** Primary page title */
  title: string;
  /** Subtitle / supporting copy */
  subtitle?: string;
  /** Decorative SVG layered behind the content */
  decoration?: ReactNode;
  /** KPI/stat row shown in a bordered pill (right side, hidden on small screens) */
  kpis?: ReactNode;
  /** Right-aligned action slot — typically a Button */
  actions?: ReactNode;
  /** Accent color */
  accent?: TwinAccent;
}

export function TwinHeaderBand({
  icon, eyebrow, title, subtitle, decoration, kpis, actions, accent = 'violet',
}: TwinHeaderBandProps) {
  const a = ACCENTS[accent];
  return (
    <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
      <div className={`absolute inset-0 bg-gradient-to-r ${a.fromBg} ${a.toBg} to-transparent`} />
      {decoration && <div className="absolute inset-0 opacity-40 pointer-events-none">{decoration}</div>}
      <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
        <div className={`relative w-11 h-11 rounded-full ${a.iconBg} border ${a.iconBorder} flex items-center justify-center flex-shrink-0`}>
          {icon}
          <motion.span
            aria-hidden
            className={`absolute inset-0 rounded-full border ${a.iconBorder}`}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeOut' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs uppercase tracking-[0.22em] ${a.eyebrow} font-medium`}>{eyebrow}</p>
          <h1 className="typo-heading-lg text-foreground/95 truncate">{title}</h1>
          {subtitle && <p className="typo-caption text-foreground/65 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {kpis && (
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40 backdrop-blur">
            {kpis}
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}
