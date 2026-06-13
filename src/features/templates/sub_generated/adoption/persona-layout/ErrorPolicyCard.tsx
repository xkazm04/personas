import { AlertTriangle, Inbox, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import { ComposerPickerShell } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerPickerShell';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import type { UseCaseErrorPolicy } from '@/lib/types/frontendTypes';

/** Sensible default — retry/heal is automatic; surface unrecovered failures
 *  in the Incidents inbox after a few consecutive failures, no Lab by default. */
export const DEFAULT_ERROR_POLICY: Required<UseCaseErrorPolicy> = {
  incident: true,
  lab: false,
  escalate_after: 3,
};

interface ErrorPolicyCardProps {
  /** Title of the capability whose error routing is being configured. */
  capabilityTitle: string;
  /** Current policy (undefined → defaults). */
  policy: UseCaseErrorPolicy | null | undefined;
  /** Persist a new policy for this capability. */
  onChange: (next: UseCaseErrorPolicy) => void;
  /** Close the card. */
  onClose: () => void;
}

/**
 * "Errors" sigil editor. Error *handling* (retry + self-healing) is a built-in,
 * automatic part of every persona — this card only configures the **aftermath**:
 * where a failure that can't auto-recover escalates to. Per-capability.
 *
 * Rendered as the sigil wide-overlay (same slot as AdoptionAnswerCard) when the
 * user clicks the Error petal.
 */
export function ErrorPolicyCard({ capabilityTitle, policy, onChange, onClose }: ErrorPolicyCardProps) {
  const { t } = useTranslation();
  const ep = t.templates.adopt_modal.error_policy;
  const dimColor = DIM_META.error.color;
  const effective: Required<UseCaseErrorPolicy> = {
    incident: policy?.incident ?? DEFAULT_ERROR_POLICY.incident,
    lab: policy?.lab ?? DEFAULT_ERROR_POLICY.lab,
    escalate_after: policy?.escalate_after ?? DEFAULT_ERROR_POLICY.escalate_after,
  };
  const patch = (p: Partial<UseCaseErrorPolicy>) => onChange({ ...effective, ...p });

  // Gold-standard petal modal — same shared shell as the answer card, carrying
  // the Error dimension's identity (accent bar / tinted border + glow / icon).
  return (
    <ComposerPickerShell
      open
      onClose={onClose}
      title={ep.title}
      subtitle={capabilityTitle}
      icon={<AlertTriangle className="w-5 h-5" />}
      accentColor={dimColor}
      size="md"
    >
      <div className="px-6 py-5 space-y-4">
        <p className="typo-caption text-foreground leading-relaxed">
          {ep.intro}
        </p>

        {/* Incident toggle */}
        <div className="flex items-start gap-3 px-3 py-2.5 rounded-card bg-secondary/30 border border-card-border/50">
          <Inbox className="w-4 h-4 text-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium text-foreground">{ep.incident_label}</div>
            <div className="typo-caption text-foreground">{ep.incident_desc}</div>
          </div>
          <AccessibleToggle
            checked={effective.incident}
            onChange={() => patch({ incident: !effective.incident })}
            label={ep.incident_label}
          />
        </div>

        {/* Lab toggle */}
        <div className="flex items-start gap-3 px-3 py-2.5 rounded-card bg-secondary/30 border border-card-border/50">
          <FlaskConical className="w-4 h-4 text-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium text-foreground">{ep.lab_label}</div>
            <div className="typo-caption text-foreground">{ep.lab_desc}</div>
          </div>
          <AccessibleToggle
            checked={effective.lab}
            onChange={() => patch({ lab: !effective.lab })}
            label={ep.lab_label}
          />
        </div>

        {/* Escalate-after threshold */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-card bg-secondary/30 border border-card-border/50">
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium text-foreground">{ep.escalate_after_label}</div>
            <div className="typo-caption text-foreground">{ep.escalate_after_desc}</div>
          </div>
          <NumberStepper
            value={effective.escalate_after}
            onChange={(v) => patch({ escalate_after: v ?? 1 })}
            min={1}
            max={20}
            ariaLabel={ep.escalate_after_label}
          />
        </div>
      </div>
    </ComposerPickerShell>
  );
}
