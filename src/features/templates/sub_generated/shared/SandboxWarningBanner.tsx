/**
 * SandboxWarningBanner — prominent security warning shown when adopting
 * templates from unverified or community origins.
 *
 * Displays the restricted capabilities and explains why sandbox mode is active.
 */
import { ShieldAlert, ShieldX, Lock, AlertTriangle } from 'lucide-react';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import { ORIGIN_LABELS } from '@/lib/templates/templateVerification';

interface SandboxWarningBannerProps {
  verification: TemplateVerification;
  className?: string;
}

export function SandboxWarningBanner({ verification, className = '' }: SandboxWarningBannerProps) {
  const { origin, trustLevel, sandboxPolicy } = verification;

  // No banner needed for verified templates
  if (trustLevel === 'verified') return null;

  const isUntrusted = trustLevel === 'untrusted';
  const Icon = isUntrusted ? ShieldX : ShieldAlert;
  const bgColor = isUntrusted ? 'bg-red-500/8' : 'bg-amber-500/8';
  const borderColor = isUntrusted ? 'border-red-500/20' : 'border-amber-500/20';
  const iconColor = isUntrusted ? 'text-red-400' : 'text-amber-400';
  const textColor = isUntrusted ? 'text-red-300/80' : 'text-amber-300/80';
  const titleColor = isUntrusted ? 'text-red-300' : 'text-amber-300';

  const restrictions: string[] = [];
  if (sandboxPolicy) {
    if (!sandboxPolicy.canEmitEvents) restrictions.push('Event emission disabled');
    if (!sandboxPolicy.canChainTrigger) restrictions.push('Chain triggers disabled');
    if (!sandboxPolicy.canUseWebhooks) restrictions.push('Webhook triggers disabled');
    if (!sandboxPolicy.canUsePolling) restrictions.push('Polling triggers disabled');
    if (sandboxPolicy.requireApproval) restrictions.push('Human review required');
    if (sandboxPolicy.budgetEnforced) restrictions.push('Budget cap enforced');
    if (sandboxPolicy.maxConcurrent < 5) restrictions.push(`Max ${sandboxPolicy.maxConcurrent} concurrent run${sandboxPolicy.maxConcurrent === 1 ? '' : 's'}`);
  }

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 p-1.5 rounded-lg ${isUntrusted ? 'bg-red-500/15' : 'bg-amber-500/15'}`}>
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`text-sm font-semibold ${titleColor}`}>
              {isUntrusted ? 'Unverified Template' : 'Community Template — Sandbox Mode'}
            </h4>
            <span className={`text-xs px-1.5 py-0.5 rounded ${isUntrusted ? 'bg-red-500/15 text-red-400/80' : 'bg-amber-500/15 text-amber-400/80'}`}>
              {ORIGIN_LABELS[origin]}
            </span>
          </div>
          <p className={`text-sm ${textColor} leading-relaxed mb-3`}>
            {isUntrusted
              ? 'This template comes from an unknown source and has not been verified. It will run with restricted capabilities to protect your system.'
              : 'This community template has not been officially verified. It will run in sandbox mode with restricted capabilities.'}
          </p>

          {restrictions.length > 0 && (
            <div className={`flex flex-wrap gap-2`}>
              {restrictions.map((r) => (
                <span
                  key={r}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md ${
                    isUntrusted
                      ? 'bg-red-500/10 text-red-400/70 border border-red-500/15'
                      : 'bg-amber-500/10 text-amber-400/70 border border-amber-500/15'
                  }`}
                >
                  <Lock className="w-2.5 h-2.5" />
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline warning for use in template cards.
 */
export function SandboxInlineWarning({ verification }: { verification: TemplateVerification }) {
  if (verification.trustLevel === 'verified') return null;

  const isUntrusted = verification.trustLevel === 'untrusted';

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
      isUntrusted
        ? 'bg-red-500/8 text-red-400/70 border border-red-500/15'
        : 'bg-amber-500/8 text-amber-400/70 border border-amber-500/15'
    }`}>
      <AlertTriangle className="w-3 h-3" />
      {isUntrusted ? 'Unverified' : 'Sandbox Mode'}
    </div>
  );
}
