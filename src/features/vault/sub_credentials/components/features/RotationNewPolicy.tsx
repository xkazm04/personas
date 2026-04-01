import { useState } from 'react';
import { Plus } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { createRotationPolicy } from '@/api/vault/rotation';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';

const ROTATION_STATUS = STATUS_COLORS.rotation!;

interface RotationNewPolicyProps {
  credentialId: string;
  initialDays: number;
  isOAuth?: boolean;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
}

export function RotationNewPolicy({
  credentialId,
  initialDays,
  isOAuth,
  onRefresh,
  onError,
}: RotationNewPolicyProps) {
  const [rotationDays, setRotationDays] = useState(initialDays);
  const [isEnablingPolicy, setIsEnablingPolicy] = useState(false);
  const [customFocused, setCustomFocused] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground/80">No rotation policy configured.</p>
      {/* Period selection */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground/80">Rotate every</span>
        <PillGroup
          options={(isOAuth ? [1, 7, 30, 90] : [30, 60, 90, 180]).map((d) => ({ value: d, label: `${d}d` }))}
          value={rotationDays}
          onChange={setRotationDays}
          layoutId={`rotation-presets-${credentialId}`}
          activeBg={ROTATION_STATUS.bg}
          activeText={ROTATION_STATUS.text}
          activeBorder={ROTATION_STATUS.border}
          customInput={
            <input
              type="number"
              value={rotationDays}
              onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
              min={1}
              data-testid="rotation-custom-days-input"
              onFocus={() => setCustomFocused(true)}
              onBlur={() => setCustomFocused(false)}
              className="w-16 px-2 py-1 bg-transparent text-sm text-foreground text-center focus-visible:outline-none font-mono"
            />
          }
          customInputActive={customFocused}
          data-testid="rotation-presets"
        />
        <span className="text-sm text-muted-foreground/60">days</span>
      </div>
      <Button
        variant="accent"
        size="sm"
        icon={isEnablingPolicy ? <LoadingSpinner size="xs" /> : <Plus className="w-3 h-3" />}
        onClick={async () => {
          setIsEnablingPolicy(true);
          onError(null);
          try {
            await createRotationPolicy({
              credential_id: credentialId,
              rotation_interval_days: rotationDays,
              policy_type: 'scheduled',
              enabled: true,
            });
            await onRefresh();
          } catch (err) {
            onError(`Failed to enable rotation: ${err instanceof Error ? err.message : 'Unknown error'}`);
          } finally {
            setIsEnablingPolicy(false);
          }
        }}
        disabled={isEnablingPolicy}
        loading={isEnablingPolicy}
        data-testid="rotation-enable-btn"
        className={`hover:opacity-90 ${ROTATION_STATUS.bg} ${ROTATION_STATUS.border} ${ROTATION_STATUS.text}`}
      >
        {isEnablingPolicy ? 'Enabling...' : 'Enable Rotation'}
      </Button>
    </div>
  );
}
