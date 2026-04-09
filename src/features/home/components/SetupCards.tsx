import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Wrench, Target, Check, X, ChevronRight, ChevronLeft, Lock, Sparkles, ArrowRight } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from "@/stores/systemStore";
import { useIsDarkTheme } from '@/stores/themeStore';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { CONNECTOR_META, ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useHomeTranslation } from '@/features/home/i18n/useTranslation';
import { STATE_DISABLED_OPACITY, STATE_LOCKED, STATE_INACTIVE_BORDER } from '@/lib/utils/designTokens';

/* ------------------------------------------------------------------ */
/*  Role definitions                                                    */
/* ------------------------------------------------------------------ */

interface RoleDef {
  id: string;
  label: string;
  subtitle: string;
  illustration: string;
  accentColor: string;
  tools: string[]; // keys into CONNECTOR_META
}

const ROLES: RoleDef[] = [
  {
    id: 'office-pro',
    label: 'Office Pro',
    subtitle: 'Non-technical user',
    illustration: '/illustrations/roles/office-pro.svg',
    accentColor: '#F59E0B',
    tools: ['google_workspace', 'microsoft_excel', 'notion'],
  },
  {
    id: 'developer',
    label: 'Developer',
    subtitle: 'Technical user',
    illustration: '/illustrations/roles/developer.svg',
    accentColor: '#06B6D4',
    tools: ['github', 'azure_devops', 'desktop_docker'],
  },
  {
    id: 'manager',
    label: 'Manager',
    subtitle: 'Planning & coordination',
    illustration: '/illustrations/roles/manager.svg',
    accentColor: '#8B5CF6',
    tools: ['cal_com', 'google_workspace', 'jira'],
  },
  {
    id: 'explorer',
    label: 'Explorer',
    subtitle: 'All tools, no filters',
    illustration: '/illustrations/roles/explorer.svg',
    accentColor: '#10B981',
    tools: ['google_workspace', 'slack', 'github', 'notion', 'jira', 'n8n'],
  },
];

/** Maps role.id → i18n key pair inside t.setup.roles */
const ROLE_I18N: Record<string, { label: string; sub: string }> = {
  'office-pro': { label: 'office_pro', sub: 'office_pro_sub' },
  developer:    { label: 'developer',  sub: 'developer_sub' },
  manager:      { label: 'manager',    sub: 'manager_sub' },
  explorer:     { label: 'explorer',   sub: 'explorer_sub' },
};

/* ------------------------------------------------------------------ */
/*  Stepper steps                                                       */
/* ------------------------------------------------------------------ */

const STEP_IDS = ['role', 'tool', 'goal'] as const;

/* ------------------------------------------------------------------ */
/*  Step indicator                                                      */
/* ------------------------------------------------------------------ */

const STEP_ICONS = [User, Wrench, Target] as const;

function StepIndicator({ current, completed, labels }: { current: number; completed: Record<string, boolean>; labels: string[] }) {
  return (
    <div className="flex items-center gap-2">
      {STEP_IDS.map((id, i) => {
        const done = completed[id];
        const active = i === current;
        const Icon = STEP_ICONS[i] ?? User;
        return (
          <div key={id} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`w-8 h-px transition-colors duration-300 ${i <= current || done ? 'bg-primary/30' : 'bg-primary/8'}`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-body transition-all duration-300 ${
                done
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : active
                    ? 'bg-primary/10 text-foreground border border-primary/20'
                    : 'bg-primary/5 text-muted-foreground/40 border border-primary/8'
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
              {labels[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1: Role selection                                              */
/* ------------------------------------------------------------------ */

function RoleStep({ selected, onSelect }: { selected: string | null; onSelect: (role: string) => void }) {
  const isDark = useIsDarkTheme();
  const { shouldAnimate } = useMotion();
  const { t } = useHomeTranslation();
  const s = t.setup;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="typo-heading-lg text-foreground">{s.choose_role}</h3>
        <p className="typo-body text-muted-foreground/60 mt-1">{s.choose_role_hint}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ROLES.map((role) => {
          const isSelected = selected === role.id;
          const i18n = ROLE_I18N[role.id];
          const roleLabel = i18n ? (s.roles as Record<string, string>)[i18n.label] ?? role.label : role.label;
          const roleSub = i18n ? (s.roles as Record<string, string>)[i18n.sub] ?? role.subtitle : role.subtitle;
          return (
            <motion.button
              key={role.id}
              whileHover={shouldAnimate ? { y: -4 } : {}}
              whileTap={shouldAnimate ? { scale: 0.97 } : {}}
              onClick={() => onSelect(role.id)}
              className={`group relative flex flex-col items-center text-center rounded-xl border-2 p-5 transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-primary/40 bg-primary/8 shadow-elevation-3'
                  : 'border-primary/10 bg-primary/3 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              {/* Illustration — darken for light themes for better contrast */}
              <div
                className="w-24 h-24 mb-3 transition-transform duration-300 group-hover:scale-105"
                style={{ color: role.accentColor }}
              >
                <img
                  src={role.illustration}
                  alt={roleLabel}
                  className="w-full h-full"
                  style={{ filter: isDark ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))' : 'drop-shadow(0 2px 8px rgba(0,0,0,0.1)) brightness(0.7) contrast(1.2)' }}
                />
              </div>

              {/* Label */}
              <span className="typo-body-lg font-bold text-foreground">{roleLabel}</span>
              <span className="typo-body text-muted-foreground/60 mt-0.5">{roleSub}</span>

              {/* Selection indicator */}
              {isSelected && (
                <motion.div
                  initial={shouldAnimate ? { scale: 0 } : false}
                  animate={{ scale: 1 }}
                  className="absolute top-3 right-3 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center"
                >
                  <Check className="w-3 h-3 text-emerald-400" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2: Tool selection                                              */
/* ------------------------------------------------------------------ */

function ToolStep({
  role,
  selected,
  onSelect,
}: {
  role: string | null;
  selected: string | null;
  onSelect: (tool: string) => void;
}) {
  const roleDef = ROLES.find((r) => r.id === role);
  const tools = roleDef?.tools ?? [];
  const { shouldAnimate } = useMotion();
  const { t } = useHomeTranslation();
  const s = t.setup;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="typo-heading-lg text-foreground">{s.pick_tool}</h3>
        <p className="typo-body text-muted-foreground/60 mt-1">
          {s.pick_tool_hint}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((toolKey) => {
          const meta = CONNECTOR_META[toolKey];
          if (!meta) return null;
          const isSelected = selected === meta.label;
          return (
            <motion.button
              key={toolKey}
              whileHover={shouldAnimate ? { y: -4 } : {}}
              whileTap={shouldAnimate ? { scale: 0.97 } : {}}
              onClick={() => onSelect(meta.label)}
              className={`group relative flex flex-col items-center text-center rounded-xl border-2 p-6 transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-primary/40 bg-primary/8 shadow-elevation-3'
                  : 'border-primary/10 bg-primary/3 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              {/* Icon */}
              <div className="w-12 h-12 flex items-center justify-center mb-3">
                {meta.iconUrl ? (
                  <ThemedConnectorIcon
                    url={meta.iconUrl}
                    label={meta.label}
                    color={meta.color}
                    size="w-10 h-10"
                  />
                ) : (
                  <meta.Icon className="w-10 h-10" style={{ color: meta.color }} />
                )}
              </div>

              <span className="typo-heading text-foreground">{meta.label}</span>

              {isSelected && (
                <motion.div
                  initial={shouldAnimate ? { scale: 0 } : false}
                  animate={{ scale: 1 }}
                  className="absolute top-3 right-3 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center"
                >
                  <Check className="w-3 h-3 text-emerald-400" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3: Goal input                                                  */
/* ------------------------------------------------------------------ */

function GoalStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useHomeTranslation();
  const s = t.setup;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="typo-heading-lg text-foreground">{s.automation_goal}</h3>
        <p className="typo-body text-muted-foreground/60 mt-1">
          {s.automation_goal_hint}
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Automatically sync new Jira tickets to a Slack channel..."
        rows={5}
        className="w-full rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 typo-body text-foreground placeholder:text-muted-foreground/40 focus-ring focus-visible:border-primary/30 resize-none transition-all"
      />
      <div className="flex items-center justify-between">
        <span className="typo-body text-muted-foreground/50">
          {value.trim().length < 10 ? s.min_chars.replace('{count}', String(value.trim().length)) : s.ready}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Celebration modal                                                   */
/* ------------------------------------------------------------------ */

function SetupCelebration({
  isOpen,
  onCreateAgent,
  onDismiss,
}: {
  isOpen: boolean;
  onCreateAgent: () => void;
  onDismiss: () => void;
}) {
  const setupRole = useSystemStore((s) => s.setupRole);
  const setupTool = useSystemStore((s) => s.setupTool);
  const setupGoal = useSystemStore((s) => s.setupGoal);
  const { shouldAnimate } = useMotion();
  const { t } = useHomeTranslation();
  const c = t.setup.celebration;

  const roleDef = ROLES.find((r) => r.id === setupRole);
  const roleI18n = roleDef ? ROLE_I18N[roleDef.id] : null;
  const roleLabel = roleI18n
    ? (t.setup.roles as Record<string, string>)[roleI18n.label] ?? roleDef?.label ?? setupRole
    : setupRole;

  const summaryItems = [
    { icon: User, label: c.role_label, value: roleLabel, color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
    { icon: Wrench, label: c.tool_label, value: setupTool, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    { icon: Target, label: c.goal_label, value: setupGoal, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  ];

  return (
    <BaseModal isOpen={isOpen} onClose={onDismiss} titleId="setup-celebration" maxWidthClass="max-w-md" panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden">
      <div className="p-6 flex flex-col items-center text-center">
        {/* Celebration icon */}
        <motion.div
          initial={shouldAnimate ? { scale: 0, rotate: -30 } : false}
          animate={{ scale: 1, rotate: 0 }}
          transition={shouldAnimate ? { type: 'spring', stiffness: 200, damping: 15, delay: 0.1 } : { duration: 0 }}
          className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-4"
        >
          <Sparkles className="w-8 h-8 text-emerald-400" />
        </motion.div>

        {/* Title */}
        <motion.h2
          initial={shouldAnimate ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldAnimate ? { delay: 0.2, duration: 0.35 } : { duration: 0 }}
          className="typo-heading-lg text-primary [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
        >
          {c.title}
        </motion.h2>
        <motion.p
          initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldAnimate ? { delay: 0.3, duration: 0.35 } : { duration: 0 }}
          className="typo-body text-foreground mt-1 mb-5"
        >
          {c.subtitle}
        </motion.p>

        {/* Summary items */}
        <div className="w-full space-y-2.5 mb-6">
          {summaryItems.map((item, i) => (
            <motion.div
              key={item.label}
              initial={shouldAnimate ? { opacity: 0, x: -16 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={shouldAnimate ? { delay: 0.35 + i * 0.08, duration: 0.3 } : { duration: 0 }}
              className={`flex items-start gap-3 p-3 rounded-xl border ${item.border} ${item.bg} text-left`}
            >
              <div className={`flex-shrink-0 mt-0.5 ${item.color}`}>
                <item.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className={`typo-caption ${item.color} block`}>{item.label}</span>
                <span className="typo-body text-foreground line-clamp-2">{item.value}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.button
          initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldAnimate ? { delay: 0.6, duration: 0.35 } : { duration: 0 }}
          whileHover={shouldAnimate ? { scale: 1.02 } : {}}
          whileTap={shouldAnimate ? { scale: 0.98 } : {}}
          onClick={onCreateAgent}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl typo-heading bg-primary/20 border border-primary/30 text-foreground hover:bg-primary/30 transition-all"
        >
          {c.cta}
          <ArrowRight className="w-4 h-4" />
        </motion.button>

        {/* Dismiss */}
        <motion.button
          initial={shouldAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={shouldAnimate ? { delay: 0.7, duration: 0.3 } : { duration: 0 }}
          onClick={onDismiss}
          className="mt-3 typo-body text-muted-foreground hover:text-foreground transition-colors"
        >
          {c.dismiss}
        </motion.button>
      </div>
    </BaseModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Stepper modal                                                       */
/* ------------------------------------------------------------------ */

function SetupStepper({ isOpen, onClose, onFinish, initialStep }: { isOpen: boolean; onClose: () => void; onFinish: () => void; initialStep: number }) {
  const setupRole = useSystemStore((s) => s.setupRole);
  const setupTool = useSystemStore((s) => s.setupTool);
  const setupGoal = useSystemStore((s) => s.setupGoal);
  const setSetupRole = useSystemStore((s) => s.setSetupRole);
  const setSetupTool = useSystemStore((s) => s.setSetupTool);
  const setSetupGoal = useSystemStore((s) => s.setSetupGoal);
  const { t } = useHomeTranslation();
  const s = t.setup;

  const [step, setStep] = useState(initialStep);
  const [goalDraft, setGoalDraft] = useState(setupGoal ?? '');
  const [direction, setDirection] = useState(1);

  const completed = {
    role: setupRole !== null,
    tool: setupTool !== null,
    goal: setupGoal !== null,
  };

  const canNext = step === 0
    ? setupRole !== null
    : step === 1
      ? setupTool !== null
      : goalDraft.trim().length >= 10;

  const goNext = () => {
    if (step === 2 && goalDraft.trim().length >= 10) {
      setSetupGoal(goalDraft.trim());
      onFinish();
      return;
    }
    setDirection(1);
    setStep((prev) => Math.min(prev + 1, 2));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const { shouldAnimate } = useMotion();

  const slideVariants = shouldAnimate
    ? {
        enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
      }
    : {
        enter: { x: 0, opacity: 1 },
        center: { x: 0, opacity: 1 },
        exit: { x: 0, opacity: 1 },
      };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="setup-stepper" maxWidthClass="max-w-2xl" panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden">
      <div className="p-6 flex flex-col" style={{ minHeight: '480px' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <StepIndicator current={step} completed={completed} labels={[s.step_role, s.step_tool, s.step_goal]} />
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Step content */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: shouldAnimate ? 0.25 : 0, ease: [0.22, 1, 0.36, 1] }}
              className="w-full"
            >
              {step === 0 && <RoleStep selected={setupRole} onSelect={setSetupRole} />}
              {step === 1 && <ToolStep role={setupRole} selected={setupTool} onSelect={setSetupTool} />}
              {step === 2 && <GoalStep value={goalDraft} onChange={setGoalDraft} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-primary/8">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl typo-heading text-muted-foreground hover:text-foreground hover:bg-primary/8 transition-all disabled:opacity-0 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
            {s.back}
          </button>
          <button
            onClick={goNext}
            disabled={!canNext}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-xl typo-heading bg-primary/15 border border-primary/20 text-foreground hover:bg-primary/25 transition-all ${STATE_DISABLED_OPACITY} disabled:cursor-not-allowed`}
          >
            {step === 2 ? s.finish : s.next}
            {step < 2 && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary cards (outside modal)                                       */
/* ------------------------------------------------------------------ */

interface CardMeta {
  id: 'role' | 'tool' | 'goal';
  stepIndex: number;
  icon: typeof User;
  gradFrom: string;
  gradTo: string;
  glowColor: string;
  accentBorder: string;
  iconText: string;
}

const CARD_DEFS: CardMeta[] = [
  {
    id: 'role',
    stepIndex: 0,
    icon: User,
    gradFrom: 'from-violet-500/8',
    gradTo: 'to-purple-500/4',
    glowColor: 'bg-violet-500/20',
    accentBorder: 'border-violet-500/15',
    iconText: 'text-violet-400',
  },
  {
    id: 'tool',
    stepIndex: 1,
    icon: Wrench,
    gradFrom: 'from-cyan-500/8',
    gradTo: 'to-blue-500/4',
    glowColor: 'bg-cyan-500/20',
    accentBorder: 'border-cyan-500/15',
    iconText: 'text-cyan-400',
  },
  {
    id: 'goal',
    stepIndex: 2,
    icon: Target,
    gradFrom: 'from-amber-500/8',
    gradTo: 'to-orange-500/4',
    glowColor: 'bg-amber-500/20',
    accentBorder: 'border-amber-500/15',
    iconText: 'text-amber-400',
  },
];

function SetupCardItem({
  card,
  index,
  value,
  locked,
  onClick,
}: {
  card: CardMeta;
  index: number;
  value: string | null;
  locked: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const completed = value !== null;
  const { shouldAnimate, staggerDelay } = useMotion();
  const { t } = useHomeTranslation();
  const s = t.setup;

  // Resolve i18n text for each card type
  const cardTitles: Record<string, string> = { role: s.card_role_title, tool: s.card_tool_title, goal: s.card_goal_title };
  const cardDescs: Record<string, string> = { role: s.card_role_desc, tool: s.card_tool_desc, goal: s.card_goal_desc };

  // For role card, resolve the role label from i18n and find illustration
  const roleDef = card.id === 'role' && value ? ROLES.find((r) => r.id === value) : null;
  const roleI18n = roleDef ? ROLE_I18N[roleDef.id] : null;
  const roleLabel = roleI18n ? (s.roles as Record<string, string>)[roleI18n.label] ?? roleDef?.label : null;
  const displayTitle = card.id === 'role' && roleLabel ? roleLabel : cardTitles[card.id];
  const badgeText = card.id === 'role' && roleLabel ? roleLabel : value;

  return (
    <motion.button
      initial={shouldAnimate ? { opacity: 0, y: 24 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { delay: 0.1 + index * staggerDelay, duration: 0.45, ease: [0.22, 1, 0.36, 1] } : { duration: 0 }}
      whileHover={locked || !shouldAnimate ? {} : { y: -6, transition: { duration: 0.25 } }}
      onClick={locked ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative text-left focus-ring h-[224px] flex flex-col ${
        locked ? STATE_LOCKED.container : 'cursor-pointer'
      }`}
    >
      {/* Illustration area */}
      <div
        className={`relative w-full h-[140px] flex-shrink-0 rounded-xl border overflow-hidden bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${locked ? STATE_INACTIVE_BORDER : card.accentBorder} shadow-elevation-1 ${!locked ? 'group-hover:shadow-elevation-3' : ''} transition-all duration-400`}
      >
        {/* Glow blob */}
        <div
          className={`absolute inset-0 ${card.glowColor} blur-3xl rounded-full opacity-0 ${!locked ? 'group-hover:opacity-40' : ''} transition-opacity duration-500 pointer-events-none scale-75`}
        />

        {/* Icon or illustration */}
        <div
          className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered && !locked ? 'opacity-100' : 'opacity-90'}`}
        >
          {roleDef ? (
            <img src={roleDef.illustration} alt={roleLabel ?? roleDef.label} className="w-20 h-20 opacity-80" />
          ) : (
            <card.icon className="w-16 h-16" strokeWidth={1} />
          )}
        </div>

        {/* Lock overlay — rendered at card level (below) to avoid compounding */}

        {/* Title overlaid at bottom */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-8 bg-gradient-to-t dark:from-black/40 from-transparent to-transparent pointer-events-none z-10">
          <h3 className="text-lg font-semibold tracking-wide uppercase dark:text-white text-foreground/85 drop-shadow-sm">
            {displayTitle}
          </h3>
        </div>

        {/* Completed badge */}
        {completed && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30">
            <Check className="w-3 h-3 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400 max-w-[80px] truncate">
              {badgeText}
            </span>
          </div>
        )}

        {/* Bottom gradient line */}
        <div
          className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/30 to-transparent`}
        />
      </div>

      {/* Description below */}
      <div className="mt-2 px-1 h-[64px] flex items-start">
        <p className="typo-body leading-relaxed dark:text-foreground text-muted-foreground/80 line-clamp-3">
          {locked
            ? card.id === 'tool'
              ? s.lock_tool
              : s.lock_goal
            : cardDescs[card.id]}
        </p>
      </div>

      {/* Full-card lock overlay — covers entire card without compounding container opacity */}
      {locked && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-card ${STATE_LOCKED.overlay}`}>
          <Lock className={`w-6 h-6 ${STATE_LOCKED.icon}`} />
        </div>
      )}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SetupCards() {
  const setupCompleted = useSystemStore((s) => s.setupCompleted);
  const dismissSetup = useSystemStore((s) => s.dismissSetup);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const setupRole = useSystemStore((s) => s.setupRole);
  const setupTool = useSystemStore((s) => s.setupTool);
  const setupGoal = useSystemStore((s) => s.setupGoal);
  const [stepperOpen, setStepperOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [initialStep, setInitialStep] = useState(0);

  const { shouldAnimate } = useMotion();

  if (setupCompleted) return null;

  const toolLocked = setupRole === null;
  const goalLocked = setupTool === null;

  const values: Record<string, string | null> = {
    role: setupRole,
    tool: setupTool,
    goal: setupGoal,
  };

  const openStep = (step: number) => {
    setInitialStep(step);
    setStepperOpen(true);
  };

  const handleStepperFinish = () => {
    setStepperOpen(false);
    setCelebrationOpen(true);
  };

  const handleCreateAgent = () => {
    setCelebrationOpen(false);
    dismissSetup();
    setSidebarSection('personas');
    setIsCreatingPersona(true);
  };

  const handleDismiss = () => {
    setCelebrationOpen(false);
    dismissSetup();
  };

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { delay: 0.2, duration: 0.4 } : { duration: 0 }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {CARD_DEFS.map((card, i) => (
          <SetupCardItem
            key={card.id}
            card={card}
            index={i}
            value={values[card.id] ?? null}
            locked={card.id === 'tool' ? toolLocked : card.id === 'goal' ? goalLocked : false}
            onClick={() => openStep(card.stepIndex)}
          />
        ))}
      </div>

      {stepperOpen && (
        <SetupStepper
          isOpen={stepperOpen}
          onClose={() => setStepperOpen(false)}
          onFinish={handleStepperFinish}
          initialStep={initialStep}
        />
      )}

      <SetupCelebration
        isOpen={celebrationOpen}
        onCreateAgent={handleCreateAgent}
        onDismiss={handleDismiss}
      />
    </motion.div>
  );
}
