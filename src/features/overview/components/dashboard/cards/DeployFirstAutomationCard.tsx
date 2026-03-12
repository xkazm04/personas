import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Rocket,
  GitBranch,
  Workflow,
  Zap,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Sparkles,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { startAutomationDesign, deployAutomation } from '@/api/agents/automations';
import type { DeployAutomationResult } from '@/api/agents/automations';

// ---------------------------------------------------------------------------
// Pre-built automation templates
// ---------------------------------------------------------------------------

interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  designPrompt: string;
  platform: 'github_actions' | 'n8n' | 'zapier';
  icon: typeof GitBranch;
}

const TEMPLATES: AutomationTemplate[] = [
  {
    id: 'github-pr-review',
    title: 'Auto-review PRs with your agent',
    description: 'Your agent reviews new pull requests using your code style guidelines.',
    designPrompt:
      'Create a GitHub Actions workflow that triggers on pull_request events and runs my agent to review the code changes, posting review comments with suggestions.',
    platform: 'github_actions',
    icon: GitBranch,
  },
  {
    id: 'n8n-scheduled-report',
    title: 'Daily summary via n8n workflow',
    description: 'Schedule your agent to generate and post daily status reports.',
    designPrompt:
      'Create an n8n workflow that triggers on a daily schedule, runs my agent to compile a status report from recent activity, and posts the summary to a webhook.',
    platform: 'n8n',
    icon: Workflow,
  },
  {
    id: 'zapier-webhook-agent',
    title: 'Trigger agent via Zapier webhook',
    description: 'Connect your agent to 6,000+ apps through a Zapier catch hook.',
    designPrompt:
      'Create a Zapier Zap with a catch hook trigger that receives data, runs my agent to process the input, and sends the result to a webhook action.',
    platform: 'zapier',
    icon: Zap,
  },
];

// ---------------------------------------------------------------------------
// DeployFirstAutomationCard
// ---------------------------------------------------------------------------

type CardPhase = 'prompt' | 'designing' | 'deploying' | 'success' | 'error';

export default function DeployFirstAutomationCard() {
  const credentials = usePersonaStore((s) => s.credentials);
  const personas = usePersonaStore((s) => s.personas);
  const isSimple = useSimpleMode();

  const [phase, setPhase] = useState<CardPhase>('prompt');
  const [deployResult, setDeployResult] = useState<DeployAutomationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Detect which platform credentials the user already has
  const platformCreds = useMemo(() => {
    const github = credentials.find(
      (c) => c.service_type.toLowerCase().includes('github'),
    );
    const n8n = credentials.find(
      (c) => c.service_type.toLowerCase().includes('n8n'),
    );
    const zapier = credentials.find(
      (c) => c.service_type.toLowerCase().includes('zapier'),
    );
    return { github, n8n, zapier };
  }, [credentials]);

  // Pick the best template based on available credentials
  const availableTemplates = useMemo(() => {
    const out: (AutomationTemplate & { credentialId: string })[] = [];
    if (platformCreds.github) {
      const tpl = TEMPLATES.find((t) => t.platform === 'github_actions')!;
      out.push({ ...tpl, credentialId: platformCreds.github.id });
    }
    if (platformCreds.n8n) {
      const tpl = TEMPLATES.find((t) => t.platform === 'n8n')!;
      out.push({ ...tpl, credentialId: platformCreds.n8n.id });
    }
    if (platformCreds.zapier) {
      const tpl = TEMPLATES.find((t) => t.platform === 'zapier')!;
      out.push({ ...tpl, credentialId: platformCreds.zapier.id });
    }
    return out;
  }, [platformCreds]);

  // Don't render if no credentials or no agents to attach
  if (availableTemplates.length === 0 || personas.length === 0) return null;

  // Use the first enabled persona as the target agent
  // Safe: personas.length > 0 guaranteed by the early return above
  const targetPersona = (personas.find((p) => p.enabled) ?? personas[0])!;

  const handleDeploy = async (template: (typeof availableTemplates)[number]) => {
    setPhase('designing');
    setErrorMsg('');

    try {
      // Step 1: AI-assisted design
      const { design_id } = await startAutomationDesign(
        targetPersona.id,
        template.designPrompt,
      );

      setPhase('deploying');

      // Step 2: Deploy the designed automation
      const result = await deployAutomation({
        personaId: targetPersona.id,
        credentialId: template.credentialId,
        designResult: { design_id, template_id: template.id },
      });

      setDeployResult(result);
      setPhase('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Deployment failed. Check your credentials and try again.');
      setPhase('error');
    }
  };

  // -- Success state ------------------------------------------------------
  if (phase === 'success' && deployResult) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-3"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-emerald-300">Automation Deployed!</h3>
        </div>
        <p className="text-sm text-muted-foreground/80">
          {deployResult.deploymentMessage}
        </p>
        {deployResult.platformUrl && (
          <a
            href={deployResult.platformUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            View on platform <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </motion.div>
    );
  }

  // -- Loading state ------------------------------------------------------
  if (phase === 'designing' || phase === 'deploying') {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
          <div>
            <p className="text-sm font-medium text-foreground/80">
              {phase === 'designing' ? 'Designing automation...' : 'Deploying to platform...'}
            </p>
            <p className="text-xs text-muted-foreground/80 mt-0.5">
              This may take a few moments
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -- Error state --------------------------------------------------------
  if (phase === 'error') {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <p className="text-sm text-rose-300">{errorMsg}</p>
        </div>
        <button
          onClick={() => setPhase('prompt')}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // -- Simple mode: single CTA -------------------------------------------
  if (isSimple) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-violet-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground/90">Ready to automate?</h3>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Set up your first automation in one click
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleDeploy(availableTemplates[0]!)}
            className="px-4 py-2 rounded-xl bg-violet-500/15 text-violet-400 text-sm font-semibold border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-1.5"
          >
            Get Started <ArrowRight className="w-3.5 h-3.5" />
          </motion.button>
        </div>
      </div>
    );
  }

  // -- Prompt state (default) ---------------------------------------------
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 blur-3xl rounded-full pointer-events-none" />

      <div className="p-5 space-y-4 relative z-10">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Rocket className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-1.5">
              Deploy Your First Automation
              <Sparkles className="w-3 h-3 text-amber-400" />
            </h3>
            <p className="text-xs text-muted-foreground/70">
              One-click deploy using your existing credentials
            </p>
          </div>
        </div>

        {/* Template cards */}
        <div className="space-y-2">
          {availableTemplates.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <motion.button
                key={tpl.id}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => handleDeploy(tpl)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-primary/10 hover:border-primary/20 bg-primary/[0.02] hover:bg-primary/[0.05] transition-all text-left group"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  tpl.platform === 'github_actions'
                    ? 'bg-gray-500/10 text-muted-foreground'
                    : tpl.platform === 'zapier'
                    ? 'bg-orange-500/10 text-orange-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground/85">{tpl.title}</p>
                  <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{tpl.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-primary/60 transition-colors shrink-0" />
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
