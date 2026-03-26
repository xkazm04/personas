import { ShieldCheck, Lock } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { cardClass, descClass, fieldClass, labelClass } from './tuneStepConstants';
import { BORDER_DEFAULT } from '@/lib/utils/designTokens';

interface SandboxPolicy {
  requireApproval?: boolean;
}

export function HumanReviewCard({
  requireApproval,
  autoApproveSeverity,
  reviewTimeout,
  sandboxPolicy,
  onUpdatePreference,
}: {
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  sandboxPolicy: SandboxPolicy | null | undefined;
  onUpdatePreference: (key: string, value: unknown) => void;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-violet-400/70"><ShieldCheck className="w-4 h-4" /></span>
        <span className="text-sm font-medium text-foreground/70">Human Review</span>
      </div>

      <div className="flex flex-col gap-3">
        {/* Require approval toggle */}
        <div className={fieldClass}>
          <label className={labelClass}>
            Require approval
            {sandboxPolicy?.requireApproval && (
              <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-sm">
                <Lock className="w-2.5 h-2.5" /> Sandbox
              </span>
            )}
          </label>
          <p className={descClass}>Pause before executing actions</p>
          <label
            className={`mt-1 inline-flex w-11 h-6 rounded-full border transition-colors items-center cursor-pointer ${
              requireApproval || sandboxPolicy?.requireApproval
                ? 'bg-violet-500/30 border-violet-500/40 justify-end'
                : `bg-secondary/40 ${BORDER_DEFAULT} justify-start`
            } ${sandboxPolicy?.requireApproval ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              role="switch"
              aria-checked={requireApproval || !!sandboxPolicy?.requireApproval}
              checked={requireApproval || !!sandboxPolicy?.requireApproval}
              disabled={!!sandboxPolicy?.requireApproval}
              onChange={() => {
                if (!sandboxPolicy?.requireApproval) {
                  onUpdatePreference('requireApproval', !requireApproval);
                }
              }}
              className="sr-only"
            />
            <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
              requireApproval || sandboxPolicy?.requireApproval ? 'bg-violet-400' : 'bg-muted-foreground/30'
            }`} />
          </label>
        </div>

        {/* Auto-approve severity */}
        <div className={fieldClass}>
          <label className={labelClass}>Auto-approve</label>
          <p className={descClass}>Skip review for lower severity</p>
          <ThemedSelect
            value={autoApproveSeverity}
            onChange={(e) => onUpdatePreference('autoApproveSeverity', e.target.value)}
            className="py-1.5 px-2.5"
          >
            <option value="info">Info only</option>
            <option value="info_warning">Info + Warning</option>
            <option value="all">All (no review)</option>
          </ThemedSelect>
        </div>

        {/* Review timeout */}
        <div className={fieldClass}>
          <label className={labelClass}>Review timeout</label>
          <p className={descClass}>Auto-reject after timeout</p>
          <ThemedSelect
            value={reviewTimeout}
            onChange={(e) => onUpdatePreference('reviewTimeout', e.target.value)}
            className="py-1.5 px-2.5"
          >
            <option value="1h">1 hour</option>
            <option value="4h">4 hours</option>
            <option value="24h">24 hours</option>
            <option value="none">No timeout</option>
          </ThemedSelect>
        </div>
      </div>
    </div>
  );
}
