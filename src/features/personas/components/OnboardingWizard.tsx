import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  SkipForward,
  Sparkles,
  Code,
  MessageSquare,
  Shield,
  BookOpen,
  TestTube,
  Package,
  Bug,
  Database,
  GitPullRequest,
  FileText,
  FlaskConical,
  RefreshCw,
  Activity,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { systemHealthCheck } from '@/api/tauriApi';
import type { HealthCheckItem } from '@/api/tauriApi';
import { BUILTIN_TEMPLATES } from '@/lib/personas/builtinTemplates';
import type { BuiltinTemplate } from '@/lib/types/templateTypes';
import { usePersonaStore } from '@/stores/personaStore';

const ICON_MAP: Record<string, LucideIcon> = {
  code: Code,
  'message-square': MessageSquare,
  MessageSquare: MessageSquare,
  shield: Shield,
  Shield: Shield,
  'book-open': BookOpen,
  'test-tube': TestTube,
  package: Package,
  bug: Bug,
  Bug: Bug,
  database: Database,
  GitPullRequest: GitPullRequest,
  FileText: FileText,
  FlaskConical: FlaskConical,
  RefreshCw: RefreshCw,
  Activity: Activity,
};

function getIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || Sparkles;
}

export default function OnboardingWizard() {
  const [step, setStep] = useState(0);

  return (
    <div className="flex items-center justify-center h-full overflow-y-auto">
      <AnimatePresence mode="wait">
        {step === 0 && <WelcomeStep key="welcome" onNext={() => setStep(1)} />}
        {step === 1 && <SystemChecksStep key="checks" onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <TemplatePickerStep key="picker" onBack={() => setStep(1)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Step 0: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-6 max-w-md text-center px-6"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-20 h-20 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center"
      >
        <Bot className="w-10 h-10 text-violet-400" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground/90">Your AI Agent Platform</h1>
        <p className="text-sm text-muted-foreground/50 mt-2 leading-relaxed">
          Create, orchestrate, and monitor autonomous AI agents.
        </p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.35 }}
        onClick={onNext}
        className="px-6 py-3 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
      >
        Get Started
        <ArrowRight className="w-4 h-4" />
      </motion.button>
    </motion.div>
  );
}

// ─── Step 1: System Checks ────────────────────────────────────────────────────

function SystemChecksStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [checks, setChecks] = useState<HealthCheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasIssues, setHasIssues] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    systemHealthCheck()
      .then((report) => {
        if (cancelled) return;
        setChecks(report.checks);
        setHasIssues(!report.all_ok);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChecks([
          { id: 'error', label: 'Health Check', status: 'error', detail: 'Could not reach the backend.' },
        ]);
        setHasIssues(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const getStatusIcon = (status: string) => {
    if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    return <XCircle className="w-4 h-4 text-red-400" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5 max-w-md w-full px-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground/90">System Checks</h2>
        <p className="text-xs text-muted-foreground/50 mt-1">
          Verifying your environment is ready.
        </p>
      </div>

      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground/40">
            <Loader2 className="w-4 h-4 animate-spin" />
            Running checks...
          </div>
        ) : (
          checks.map((check, i) => (
            <motion.div
              key={check.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
              className="flex items-center gap-3 px-4 py-3"
            >
              {getStatusIcon(check.status)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/80">{check.label}</p>
                {check.detail && (
                  <p className="text-xs text-muted-foreground/40 truncate">{check.detail}</p>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      {hasIssues && !loading && (
        <p className="text-xs text-amber-400/80">
          Some checks reported issues. You can still continue, but some features may not work correctly.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={loading}
          className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Step 2: Template Picker ──────────────────────────────────────────────────

function TemplatePickerStep({ onBack }: { onBack: () => void }) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const handlePick = useCallback(
    async (template: BuiltinTemplate) => {
      setCreatingId(template.id);
      try {
        const persona = await createPersona({
          name: template.name,
          description: template.description,
          system_prompt: template.payload.full_prompt_markdown,
          icon: template.icon,
          color: template.color,
        });
        setSidebarSection('personas');
        selectPersona(persona.id);
      } catch (err) {
        console.error('Failed to create persona from template:', err);
      } finally {
        setCreatingId(null);
      }
    },
    [createPersona, selectPersona, setSidebarSection],
  );

  const handleSkip = () => {
    setSidebarSection('personas');
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5 max-w-lg w-full px-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground/90">Choose a Template</h2>
        <p className="text-xs text-muted-foreground/50 mt-1">
          Pick a template to create your first agent, or skip to start from scratch.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {BUILTIN_TEMPLATES.map((template, index) => {
          const Icon = getIcon(template.icon);
          const isCreating = creatingId === template.id;

          return (
            <motion.button
              key={template.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.25 }}
              onClick={() => handlePick(template)}
              disabled={creatingId !== null}
              className="flex items-start gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 transition-colors text-left disabled:opacity-50"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border"
                style={{
                  backgroundColor: `${template.color}18`,
                  borderColor: `${template.color}30`,
                }}
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: template.color }} />
                ) : (
                  <Icon className="w-4 h-4" style={{ color: template.color }} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/85 truncate">{template.name}</p>
                <p className="text-[11px] text-muted-foreground/45 line-clamp-2 leading-relaxed mt-0.5">
                  {template.description}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleSkip}
          className="px-4 py-2.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors flex items-center gap-1.5"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip for now
        </button>
      </div>
    </motion.div>
  );
}
