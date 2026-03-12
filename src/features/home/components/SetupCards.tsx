import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Wrench, Target, Check, X, ChevronRight, ChevronLeft, Lock } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { usePersonaStore } from '@/stores/personaStore';
import { CONNECTOR_META, ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';

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
    id: 'office-rat',
    label: 'Office Rat',
    subtitle: 'Non-technical user',
    illustration: '/illustrations/roles/office-rat.svg',
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
];

/* ------------------------------------------------------------------ */
/*  Stepper steps                                                       */
/* ------------------------------------------------------------------ */

const STEPS = [
  { id: 'role' as const, icon: User, label: 'Role' },
  { id: 'tool' as const, icon: Wrench, label: 'Tool' },
  { id: 'goal' as const, icon: Target, label: 'Goal' },
];

/* ------------------------------------------------------------------ */
/*  Step indicator                                                      */
/* ------------------------------------------------------------------ */

function StepIndicator({ current, completed }: { current: number; completed: Record<string, boolean> }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => {
        const done = completed[step.id];
        const active = i === current;
        return (
          <div key={step.id} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`w-8 h-px transition-colors duration-300 ${i <= current || done ? 'bg-primary/30' : 'bg-primary/8'}`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-300 ${
                done
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : active
                    ? 'bg-primary/10 text-foreground border border-primary/20'
                    : 'bg-primary/5 text-muted-foreground/40 border border-primary/8'
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : <step.icon className="w-3 h-3" />}
              {step.label}
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
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Choose your role</h3>
        <p className="text-sm text-muted-foreground/60 mt-1">We'll tailor the experience to match how you work.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {ROLES.map((role) => {
          const isSelected = selected === role.label;
          return (
            <motion.button
              key={role.id}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(role.label)}
              className={`group relative flex flex-col items-center text-center rounded-xl border-2 p-5 transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-primary/40 bg-primary/8 shadow-lg'
                  : 'border-primary/10 bg-primary/3 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              {/* Illustration */}
              <div
                className="w-24 h-24 mb-3 transition-transform duration-300 group-hover:scale-105"
                style={{ color: role.accentColor }}
              >
                <img
                  src={role.illustration}
                  alt={role.label}
                  className="w-full h-full"
                  style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))' }}
                />
              </div>

              {/* Label */}
              <span className="text-base font-bold text-foreground">{role.label}</span>
              <span className="text-xs text-muted-foreground/60 mt-0.5">{role.subtitle}</span>

              {/* Selection indicator */}
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
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
  const roleDef = ROLES.find((r) => r.label === role);
  const tools = roleDef?.tools ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Pick your favorite tool</h3>
        <p className="text-sm text-muted-foreground/60 mt-1">
          This will be your first connector integration.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {tools.map((toolKey) => {
          const meta = CONNECTOR_META[toolKey];
          if (!meta) return null;
          const isSelected = selected === meta.label;
          return (
            <motion.button
              key={toolKey}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(meta.label)}
              className={`group relative flex flex-col items-center text-center rounded-xl border-2 p-6 transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-primary/40 bg-primary/8 shadow-lg'
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

              <span className="text-sm font-semibold text-foreground">{meta.label}</span>

              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
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
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">What do you want to automate?</h3>
        <p className="text-sm text-muted-foreground/60 mt-1">
          Describe your first automation goal — we'll help you set it up.
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Automatically sync new Jira tickets to a Slack channel..."
        rows={5}
        className="w-full rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/30 resize-none transition-all"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/50">
          {value.trim().length < 10 ? `Min 10 characters (${value.trim().length}/10)` : 'Ready to save'}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stepper modal                                                       */
/* ------------------------------------------------------------------ */

function SetupStepper({ isOpen, onClose, initialStep }: { isOpen: boolean; onClose: () => void; initialStep: number }) {
  const setupRole = usePersonaStore((s) => s.setupRole);
  const setupTool = usePersonaStore((s) => s.setupTool);
  const setupGoal = usePersonaStore((s) => s.setupGoal);
  const setSetupRole = usePersonaStore((s) => s.setSetupRole);
  const setSetupTool = usePersonaStore((s) => s.setSetupTool);
  const setSetupGoal = usePersonaStore((s) => s.setSetupGoal);

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
      onClose();
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, 2));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="setup-stepper" maxWidthClass="max-w-2xl">
      <div className="p-6 flex flex-col" style={{ minHeight: '480px' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <StepIndicator current={step} completed={completed} />
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
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-primary/8 transition-all disabled:opacity-0 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={goNext}
            disabled={!canNext}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold bg-primary/15 border border-primary/20 text-foreground hover:bg-primary/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {step === 2 ? 'Finish' : 'Next'}
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
  defaultTitle: string;
  description: string;
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
    defaultTitle: 'Your Role',
    description: 'Tell us your role so we can tailor the experience.',
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
    defaultTitle: 'Favorite Tool',
    description: 'Pick the first connector you want to integrate.',
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
    defaultTitle: 'Automation Goal',
    description: 'Describe what you would like to automate first.',
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
  const displayTitle = card.id === 'role' && value ? value : card.defaultTitle;

  // For role card, find the role's illustration
  const roleDef = card.id === 'role' && value ? ROLES.find((r) => r.label === value) : null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={locked ? {} : { y: -6, transition: { duration: 0.25 } }}
      onClick={locked ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background h-[200px] flex flex-col ${
        locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      {/* Illustration area */}
      <div
        className={`relative w-full h-[140px] flex-shrink-0 rounded-xl border overflow-hidden bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${card.accentBorder} shadow-sm ${!locked ? 'group-hover:shadow-xl' : ''} transition-all duration-400`}
      >
        {/* Glow blob */}
        <div
          className={`absolute inset-0 ${card.glowColor} blur-3xl rounded-full opacity-0 ${!locked ? 'group-hover:opacity-40' : ''} transition-opacity duration-500 pointer-events-none scale-75`}
        />

        {/* Icon or illustration */}
        <div
          className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered && !locked ? 'opacity-50' : 'opacity-20'}`}
        >
          {roleDef ? (
            <img src={roleDef.illustration} alt={roleDef.label} className="w-20 h-20 opacity-80" />
          ) : (
            <card.icon className="w-16 h-16" strokeWidth={1} />
          )}
        </div>

        {/* Lock overlay */}
        {locked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
            <Lock className="w-6 h-6 text-muted-foreground/40" />
          </div>
        )}

        {/* Title overlaid at bottom */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-6 bg-gradient-to-t from-black/40 to-transparent pointer-events-none z-10">
          <h3 className="text-lg font-extrabold tracking-wide text-foreground/80 uppercase drop-shadow-sm">
            {displayTitle}
          </h3>
        </div>

        {/* Completed badge */}
        {completed && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30">
            <Check className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] font-medium text-emerald-400 max-w-[80px] truncate">
              {value}
            </span>
          </div>
        )}

        {/* Bottom gradient line */}
        <div
          className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/30 to-transparent`}
        />
      </div>

      {/* Description below */}
      <div className="mt-1.5 px-1 h-[48px] flex items-start">
        <p className="text-xs leading-relaxed text-muted-foreground/80 line-clamp-3">
          {locked
            ? card.id === 'tool'
              ? 'Select a role first to unlock tool options.'
              : 'Select a tool first to set your goal.'
            : card.description}
        </p>
      </div>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SetupCards() {
  const setupCompleted = usePersonaStore((s) => s.setupCompleted);
  const setupRole = usePersonaStore((s) => s.setupRole);
  const setupTool = usePersonaStore((s) => s.setupTool);
  const setupGoal = usePersonaStore((s) => s.setupGoal);
  const dismissSetup = usePersonaStore((s) => s.dismissSetup);

  const [stepperOpen, setStepperOpen] = useState(false);
  const [initialStep, setInitialStep] = useState(0);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/10" />
          <span className="typo-label text-muted-foreground/50">Get Started</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/10" />
        </div>
        <button
          onClick={dismissSetup}
          className="text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
        >
          Dismiss
        </button>
      </div>

      <div className="grid grid-cols-3 gap-5">
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
          initialStep={initialStep}
        />
      )}
    </motion.div>
  );
}
