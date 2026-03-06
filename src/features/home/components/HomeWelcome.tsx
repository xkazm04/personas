import { motion } from 'framer-motion';
import {
  BarChart3,
  Bot,
  Zap,
  Key,
  FlaskConical,
  Users,
  Cloud,
  Settings,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import type { SidebarSection } from '@/lib/types/types';
import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

interface NavCard {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
  description: string;
  color: string;        // tailwind color key
  gradFrom: string;
  gradTo: string;
  glowColor: string;
  accentBorder: string;
  iconBg: string;
  iconText: string;
}

const NAV_CARDS: NavCard[] = [
  {
    id: 'overview',
    icon: BarChart3,
    label: 'Overview',
    description: 'Dashboard, analytics, executions, and real-time system monitoring',
    color: 'indigo',
    gradFrom: 'from-indigo-500/8',
    gradTo: 'to-violet-500/4',
    glowColor: 'bg-indigo-500/20',
    accentBorder: 'border-indigo-500/20 hover:border-indigo-400/40',
    iconBg: 'bg-indigo-500/15',
    iconText: 'text-indigo-400',
  },
  {
    id: 'personas',
    icon: Bot,
    label: 'Agents',
    description: 'Create, configure, and manage your AI agent personas',
    color: 'cyan',
    gradFrom: 'from-cyan-500/8',
    gradTo: 'to-blue-500/4',
    glowColor: 'bg-cyan-500/20',
    accentBorder: 'border-cyan-500/20 hover:border-cyan-400/40',
    iconBg: 'bg-cyan-500/15',
    iconText: 'text-cyan-400',
  },
  {
    id: 'events',
    icon: Zap,
    label: 'Events',
    description: 'Configure event triggers, webhooks, and automations',
    color: 'amber',
    gradFrom: 'from-amber-500/8',
    gradTo: 'to-orange-500/4',
    glowColor: 'bg-amber-500/20',
    accentBorder: 'border-amber-500/20 hover:border-amber-400/40',
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-400',
  },
  {
    id: 'credentials',
    icon: Key,
    label: 'Keys',
    description: 'Manage API credentials, database connections, and secrets',
    color: 'emerald',
    gradFrom: 'from-emerald-500/8',
    gradTo: 'to-teal-500/4',
    glowColor: 'bg-emerald-500/20',
    accentBorder: 'border-emerald-500/20 hover:border-emerald-400/40',
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-400',
  },
  {
    id: 'design-reviews',
    icon: FlaskConical,
    label: 'Templates',
    description: 'Import n8n workflows and generate agent templates',
    color: 'purple',
    gradFrom: 'from-purple-500/8',
    gradTo: 'to-fuchsia-500/4',
    glowColor: 'bg-purple-500/20',
    accentBorder: 'border-purple-500/20 hover:border-purple-400/40',
    iconBg: 'bg-purple-500/15',
    iconText: 'text-purple-400',
  },
  {
    id: 'team',
    icon: Users,
    label: 'Teams',
    description: 'Build multi-agent team pipelines with drag-and-drop',
    color: 'rose',
    gradFrom: 'from-rose-500/8',
    gradTo: 'to-pink-500/4',
    glowColor: 'bg-rose-500/20',
    accentBorder: 'border-rose-500/20 hover:border-rose-400/40',
    iconBg: 'bg-rose-500/15',
    iconText: 'text-rose-400',
  },
  {
    id: 'cloud',
    icon: Cloud,
    label: 'Cloud',
    description: 'Deploy agents to cloud infrastructure and GitLab CI',
    color: 'sky',
    gradFrom: 'from-sky-500/8',
    gradTo: 'to-blue-500/4',
    glowColor: 'bg-sky-500/20',
    accentBorder: 'border-sky-500/20 hover:border-sky-400/40',
    iconBg: 'bg-sky-500/15',
    iconText: 'text-sky-400',
  },
  {
    id: 'settings',
    icon: Settings,
    label: 'Settings',
    description: 'Account, appearance, notifications, and engine config',
    color: 'slate',
    gradFrom: 'from-slate-400/8',
    gradTo: 'to-zinc-500/4',
    glowColor: 'bg-slate-400/15',
    accentBorder: 'border-slate-400/20 hover:border-slate-300/40',
    iconBg: 'bg-slate-400/15',
    iconText: 'text-slate-400',
  },
];

// ---------------------------------------------------------------------------
// Decorative SVG patterns per card
// ---------------------------------------------------------------------------

function CardPattern({ color, index }: { color: string; index: number }) {
  const patterns = [
    // Concentric circles
    <svg key="circles" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      <circle cx="96" cy="32" r="48" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="96" cy="32" r="32" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="96" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>,
    // Diagonal grid
    <svg key="grid" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      {[0, 16, 32, 48, 64, 80, 96, 112].map(y => (
        <line key={`h${y}`} x1="0" y1={y} x2="128" y2={y} stroke="currentColor" strokeWidth="0.5" />
      ))}
      {[0, 16, 32, 48, 64, 80, 96, 112].map(x => (
        <line key={`v${x}`} x1={x} y1="0" x2={x} y2="128" stroke="currentColor" strokeWidth="0.5" />
      ))}
    </svg>,
    // Hexagonal dots
    <svg key="hex" className="absolute top-0 right-0 w-32 h-32 opacity-[0.06]" viewBox="0 0 128 128">
      {[20, 50, 80, 110].map(x =>
        [15, 45, 75, 105].map(y => (
          <circle key={`${x}-${y}`} cx={x + (y % 30 === 15 ? 0 : 15)} cy={y} r="2" fill="currentColor" />
        ))
      )}
    </svg>,
    // Diagonal lines
    <svg key="diag" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      {[0, 20, 40, 60, 80, 100, 120, 140].map(offset => (
        <line key={offset} x1={offset} y1="0" x2={offset - 80} y2="128" stroke="currentColor" strokeWidth="0.5" />
      ))}
    </svg>,
    // Rounded squares
    <svg key="squares" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      <rect x="64" y="0" width="48" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="80" y="16" width="48" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="48" y="32" width="48" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>,
    // Diamond pattern
    <svg key="diamond" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      <polygon points="96,8 120,32 96,56 72,32" fill="none" stroke="currentColor" strokeWidth="1" />
      <polygon points="96,32 108,44 96,56 84,44" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>,
    // Wave lines
    <svg key="wave" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      {[20, 40, 60, 80].map(y => (
        <path key={y} d={`M0,${y} Q32,${y - 12} 64,${y} T128,${y}`} fill="none" stroke="currentColor" strokeWidth="0.7" />
      ))}
    </svg>,
    // Gear-like circle
    <svg key="gear" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128">
      <circle cx="96" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
      <circle cx="96" cy="32" r="12" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="96" cy="32" r="3" fill="currentColor" />
    </svg>,
  ];

  return <div className={color}>{patterns[index % patterns.length]}</div>;
}

// ---------------------------------------------------------------------------
// Animated border trace
// ---------------------------------------------------------------------------

function AnimatedBorderGlow({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
      <motion.div
        className={`absolute w-24 h-24 ${color} blur-2xl rounded-full`}
        animate={{
          x: ['-10%', '110%', '110%', '-10%', '-10%'],
          y: ['-10%', '-10%', '110%', '110%', '-10%'],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: 'linear',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation Card
// ---------------------------------------------------------------------------

function NavigationCard({ card, index, onClick }: { card: NavCard; index: number; onClick: () => void }) {
  const Icon = card.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.06,
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      onClick={onClick}
      className={`group relative text-left rounded-xl border bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${card.accentBorder} shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      <AnimatedBorderGlow color={card.glowColor} />

      {/* Background glow */}
      <div className={`absolute -top-8 -right-8 w-32 h-32 ${card.glowColor} blur-3xl rounded-full opacity-0 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none`} />

      {/* Pattern */}
      <CardPattern color={card.iconText} index={index} />

      {/* Content */}
      <div className="relative z-10 p-4">
        <div className="flex items-start justify-between mb-4">
          <div className={`w-12 h-12 rounded-xl ${card.iconBg} border border-white/5 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-300`}>
            <Icon className={`w-6 h-6 ${card.iconText}`} />
          </div>
          <ArrowRight className={`w-4 h-4 ${card.iconText} opacity-0 group-hover:opacity-100 translate-x-[-8px] group-hover:translate-x-0 transition-all duration-300`} />
        </div>

        <h3 className="text-sm font-bold text-foreground/90 mb-1.5 tracking-wide">
          {card.label}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground/70 line-clamp-2">
          {card.description}
        </p>
      </div>

      {/* Bottom accent line */}
      <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/20 to-transparent`} />
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Hero decorative mesh
// ---------------------------------------------------------------------------

function HeroMesh() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Large ambient glows */}
      <div className="absolute top-[-20%] left-[10%] w-[500px] h-[500px] bg-indigo-500/5 blur-[150px] rounded-full" />
      <div className="absolute top-[10%] right-[-5%] w-[400px] h-[400px] bg-cyan-500/5 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] left-[30%] w-[350px] h-[350px] bg-purple-500/4 blur-[120px] rounded-full" />

      {/* Animated floating orbs */}
      <motion.div
        className="absolute top-[15%] left-[20%] w-2 h-2 rounded-full bg-indigo-400/30"
        animate={{ y: [0, -15, 0], opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[25%] right-[25%] w-1.5 h-1.5 rounded-full bg-cyan-400/25"
        animate={{ y: [0, -10, 0], opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
      <motion.div
        className="absolute top-[10%] right-[40%] w-1 h-1 rounded-full bg-purple-400/30"
        animate={{ y: [0, -12, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />

      {/* Subtle grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HomeWelcome
// ---------------------------------------------------------------------------

export default function HomeWelcome() {
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const user = useAuthStore((s) => s.user);
  const personas = usePersonaStore((s) => s.personas);
  const credentials = usePersonaStore((s) => s.credentials);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Operator';

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <HeroMesh />

      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="max-w-5xl mx-auto w-full px-6 py-8 space-y-8">

          {/* Hero section */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="text-center pt-4 pb-2"
          >
            {/* Animated logo mark */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center justify-center mb-6"
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                  <Sparkles className="w-8 h-8 text-indigo-400" />
                </div>
                {/* Orbiting ring */}
                <div className="absolute inset-[-6px] rounded-xl border border-indigo-500/10 animate-spin-slow" />
                {/* Corner dots */}
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-400/50" />
                <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-purple-400/50" />
              </div>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-3xl font-bold bg-gradient-to-r from-foreground via-foreground/80 to-foreground/60 bg-clip-text text-transparent mb-2"
            >
              {greeting}, {displayName}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="text-sm text-muted-foreground/70 max-w-md mx-auto"
            >
              {personas.length > 0
                ? `You have ${personas.length} agent${personas.length !== 1 ? 's' : ''} and ${credentials.length} credential${credentials.length !== 1 ? 's' : ''} configured.`
                : 'Get started by creating your first agent or exploring the platform.'}
            </motion.p>
          </motion.div>

          {/* Section label */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.3 }}
            className="flex items-center gap-3"
          >
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-muted-foreground/50">
              Quick Navigation
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </motion.div>

          {/* Navigation cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {NAV_CARDS.map((card, i) => (
              <NavigationCard
                key={card.id}
                card={card}
                index={i}
                onClick={() => setSidebarSection(card.id)}
              />
            ))}
          </div>

          {/* Footer accent */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="flex items-center justify-center pt-4 pb-8"
          >
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-muted-foreground/30 font-medium">
              <div className="w-8 h-px bg-gradient-to-r from-transparent to-muted-foreground/20" />
              personas platform
              <div className="w-8 h-px bg-gradient-to-l from-transparent to-muted-foreground/20" />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
