import { CheckCircle, AlertTriangle, XCircle, Lightbulb, type LucideIcon } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import type { DesignTestResult } from '@/lib/types/designTypes';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';
import { useTemplateMotion, REDUCED_FRAMER } from '@/features/templates/animationPresets';
import { useTranslation } from '@/i18n/useTranslation';

const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
  },
};

const reducedListContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0, ...REDUCED_FRAMER } },
};

const reducedListItem: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, y: 0, transition: REDUCED_FRAMER },
};

interface DesignTestResultsProps {
  result: DesignTestResult;
}

const FEASIBILITY_META: Record<string, { icon: LucideIcon; label: string }> = {
  ready: { icon: CheckCircle, label: 'Ready' },
  partial: { icon: AlertTriangle, label: 'Partial' },
  blocked: { icon: XCircle, label: 'Blocked' },
};

function getFeasibilityExplanation(result: DesignTestResult): string {
  const caps = result.confirmed_capabilities.length;
  const issues = result.issues.length;

  if (result.overall_feasibility === 'ready') {
    return `Your persona passes all checks -- ${caps} capabilit${caps !== 1 ? 'ies' : 'y'} confirmed with no issues found.`;
  }
  if (result.overall_feasibility === 'blocked') {
    return `${issues} issue${issues !== 1 ? 's' : ''} prevent${issues === 1 ? 's' : ''} this persona from running. Resolve the issues listed below before proceeding.`;
  }
  // partial
  if (caps > 0 && issues > 0) {
    return `${caps} capabilit${caps !== 1 ? 'ies' : 'y'} confirmed, but ${issues} issue${issues !== 1 ? 's' : ''} may limit functionality. Review the issues below to improve coverage.`;
  }
  if (issues > 0) {
    return `${issues} issue${issues !== 1 ? 's were' : ' was'} found that may affect persona performance.`;
  }
  return 'Some capabilities could not be fully verified. Consider refining your persona configuration.';
}

function getNextSteps(result: DesignTestResult): string[] {
  if (result.overall_feasibility === 'ready') return [];

  const steps: string[] = [];
  const issueText = result.issues.join(' ').toLowerCase();

  if (issueText.includes('tool') || issueText.includes('connector')) {
    steps.push('Check that all required tools are assigned and their credentials are configured.');
  }
  if (issueText.includes('trigger') || issueText.includes('schedule') || issueText.includes('webhook')) {
    steps.push('Verify trigger configuration matches the persona\'s intended workflow.');
  }
  if (issueText.includes('prompt') || issueText.includes('instruction') || issueText.includes('section')) {
    steps.push('Refine the persona prompt to include clearer instructions and examples.');
  }
  if (issueText.includes('credential') || issueText.includes('auth')) {
    steps.push('Add or reconnect missing credentials in the Credentials section.');
  }

  if (steps.length === 0) {
    if (result.overall_feasibility === 'blocked') {
      steps.push('Review each issue above and address them before running this persona.');
    } else {
      steps.push('Address the issues listed above to improve your persona\'s reliability.');
    }
  }

  if (result.overall_feasibility !== 'blocked') {
    steps.push('Re-run the design analysis after making changes to verify improvements.');
  }

  return steps;
}

export function DesignTestResults({ result }: DesignTestResultsProps) {
  const { t } = useTranslation();
  const colors = FEASIBILITY_COLORS[result.overall_feasibility] ?? FEASIBILITY_COLORS.partial!;
  const meta = FEASIBILITY_META[result.overall_feasibility] ?? FEASIBILITY_META.partial!;
  const Icon = meta.icon;
  const explanation = getFeasibilityExplanation(result);
  const nextSteps = getNextSteps(result);
  const { prefersReducedMotion } = useTemplateMotion();

  const container = prefersReducedMotion ? reducedListContainer : listContainer;
  const item = prefersReducedMotion ? reducedListItem : listItem;

  return (
    <div className="space-y-3 py-1">
      {/* Feasibility badge */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-modal ${colors.bg} border ${colors.border}`}>
          <Icon className={`w-4 h-4 ${colors.text}`} />
          <span className={`typo-body font-medium ${colors.text}`}>{meta.label}</span>
        </div>
        <span className="typo-body text-foreground">{t.templates.design.feasibility_assessment}</span>
      </div>

      {/* Plain-language explanation */}
      <p className="typo-body text-foreground leading-relaxed">
        {explanation}
      </p>

      {/* Confirmed capabilities */}
      {result.confirmed_capabilities.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="typo-code font-mono text-foreground uppercase tracking-wider">
            Confirmed Capabilities
          </h4>
          <motion.div
            className="space-y-1"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {result.confirmed_capabilities.map((cap, i) => (
              <motion.div key={i} variants={item} className="flex items-start gap-2 typo-body">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground/90">{cap}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Issues */}
      {result.issues.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="typo-code font-mono text-foreground uppercase tracking-wider">
            Issues
          </h4>
          <motion.div
            className="space-y-1"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {result.issues.map((issue, i) => (
              <motion.div key={i} variants={item} className="flex items-start gap-2 typo-body">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground/90">{issue}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Next steps (non-ready only) */}
      {nextSteps.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="typo-code font-mono text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" />
            Suggested Next Steps
          </h4>
          <motion.div
            className="space-y-1"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {nextSteps.map((step, i) => (
              <motion.div key={i} variants={item} className="flex items-start gap-2 typo-body">
                <span className="text-foreground mt-0.5 flex-shrink-0 typo-body">{i + 1}.</span>
                <span className="text-foreground">{step}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
