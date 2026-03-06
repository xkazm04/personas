import { useState } from 'react';
import { Trash2, Pencil, RotateCw, ShieldCheck, Clock, Plus, Loader2 } from 'lucide-react';
import * as api from '@/api/tauriApi';
import type { RotationStatus } from '@/api/rotation';
import { createRotationPolicy, updateRotationPolicy, rotateCredentialNow, deleteRotationPolicy } from '@/api/rotation';
import { STATUS_COLORS } from '@/lib/utils/designTokens';

const ROTATION_STATUS = STATUS_COLORS.rotation!;
interface RotationPolicyControlsProps {
  credentialId: string;
  rotationStatus: RotationStatus;
  rotationCountdown: string | null;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
  onError: (message: string | null) => void;
}
export function RotationPolicyControls({
  credentialId,
  rotationStatus,
  rotationCountdown,
  onRefresh,
  onHealthcheck,
  onError,
}: RotationPolicyControlsProps) {
  const [isRotating, setIsRotating] = useState(false);
  const [isRemovingPolicy, setIsRemovingPolicy] = useState(false);
  const [isEnablingPolicy, setIsEnablingPolicy] = useState(false);
  const [rotationDays, setRotationDays] = useState(rotationStatus.rotation_interval_days ?? 90);
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);
  if (rotationStatus.has_policy) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${rotationStatus.policy_enabled ? ROTATION_STATUS.color : 'text-muted-foreground/80'}`} />
            <div className="text-sm">
              <span className={rotationStatus.policy_enabled ? `${ROTATION_STATUS.color} font-medium` : 'text-muted-foreground/90'}>
                {rotationStatus.policy_enabled ? 'Auto-rotation active' : 'Rotation paused'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rotationCountdown && rotationStatus.policy_enabled && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground/90 font-mono">
                <Clock className="w-3 h-3" />
                {rotationCountdown}
              </span>
            )}
            <button
              onClick={async () => {
                setIsRotating(true);
                onError(null);
                try {
                  await rotateCredentialNow(credentialId);
                  await onRefresh();
                  onHealthcheck(credentialId);
                } catch (err) {
                  onError(`Rotation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                } finally {
                  setIsRotating(false);
                }
              }}
              disabled={isRotating}
              data-testid="rotation-rotate-now-btn"
              className={`flex items-center gap-1 px-2.5 py-1 border rounded-xl text-sm font-medium transition-all disabled:opacity-50 hover:opacity-90 ${ROTATION_STATUS.bgColor} ${ROTATION_STATUS.borderColor} ${ROTATION_STATUS.color}`}
            >
              <RotateCw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />
              Rotate Now
            </button>
            <button
              onClick={async () => {
                setIsRemovingPolicy(true);
                onError(null);
                try {
                  const allPolicies = await api.listRotationPolicies(credentialId);
                  for (const p of allPolicies) {
                    await deleteRotationPolicy(p.id);
                  }
                  await onRefresh();
                } catch (err) {
                  onError(`Failed to remove policy: ${err instanceof Error ? err.message : 'Unknown error'}`);
                } finally {
                  setIsRemovingPolicy(false);
                }
              }}
              disabled={isRemovingPolicy}
              data-testid="rotation-delete-policy-btn"
              className="p-1 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Remove rotation policy"
            >
              {isRemovingPolicy ? <Loader2 className="w-3 h-3 animate-spin text-red-400/70" /> : <Trash2 className="w-3 h-3 text-red-400/50" />}
            </button>
          </div>
        </div>
        {/* Rotation period editor */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground/80">Rotate every</span>
          {isEditingPeriod ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={rotationDays}
                onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                min={1}
                data-testid="rotation-days-input"
                className={`w-16 px-2 py-0.5 bg-background/50 border rounded-xl text-sm text-foreground text-center focus:outline-none focus:ring-1 ${ROTATION_STATUS.borderColor} ${ROTATION_STATUS.ringColor!}`}
              />
              <span className="text-sm text-muted-foreground/80">days</span>
              <button
                onClick={async () => {
                  onError(null);
                  try {
                    const allPolicies = await api.listRotationPolicies(credentialId);
                    if (allPolicies.length > 0) {
                      await updateRotationPolicy(allPolicies[0]!.id, { rotation_interval_days: rotationDays });
                    }
                    await onRefresh();
                    setIsEditingPeriod(false);
                  } catch (err) {
                    onError(`Failed to update rotation period: ${err instanceof Error ? err.message : 'Unknown error'}`);
                  }
                }}
                data-testid="rotation-save-period-btn"
                className={`px-2 py-0.5 border rounded-lg text-sm font-medium transition-colors hover:opacity-90 ${ROTATION_STATUS.bgColor} ${ROTATION_STATUS.borderColor} ${ROTATION_STATUS.color}`}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setRotationDays(rotationStatus.rotation_interval_days ?? 90);
                  setIsEditingPeriod(false);
                }}
                data-testid="rotation-cancel-period-btn"
                className="px-2 py-0.5 text-muted-foreground/80 hover:text-foreground/90 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingPeriod(true)}
              data-testid="rotation-edit-period-btn"
              className="flex items-center gap-1 px-2 py-0.5 bg-secondary/40 hover:bg-secondary/60 border border-primary/15 rounded-lg text-sm text-foreground/80 transition-colors"
            >
              <span className="font-mono">{rotationStatus.rotation_interval_days ?? 90}</span>
              <span>days</span>
              <Pencil className="w-2.5 h-2.5 text-muted-foreground/60 ml-0.5" />
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground/80">No rotation policy configured.</p>
      {/* Period selection */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground/80">Rotate every</span>
        <div className="flex items-center gap-1">
          {[30, 60, 90, 180].map((d) => (
            <button
              key={d}
              onClick={() => setRotationDays(d)}
              data-testid={`rotation-preset-${d}-btn`}
              className={`px-2 py-0.5 rounded-lg text-sm font-mono transition-colors ${
                rotationDays === d
                  ? `${ROTATION_STATUS.bgColor} ${ROTATION_STATUS.color} border ${ROTATION_STATUS.borderColor}`
                  : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60'
              }`}
            >
              {d}d
            </button>
          ))}
          <input
            type="number"
            value={rotationDays}
            onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            min={1}
            data-testid="rotation-custom-days-input"
            className={`w-16 px-2 py-0.5 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground text-center focus:outline-none focus:ring-1 ${ROTATION_STATUS.ringColor!}`}
          />
          <span className="text-sm text-muted-foreground/60">days</span>
        </div>
      </div>
      <button
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
        data-testid="rotation-enable-btn"
        className={`flex items-center gap-1 px-2.5 py-1 border rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${ROTATION_STATUS.bgColor} ${ROTATION_STATUS.borderColor} ${ROTATION_STATUS.color}`}
      >
        {isEnablingPolicy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        {isEnablingPolicy ? 'Enabling...' : 'Enable Rotation'}
      </button>
    </div>
  );
}
