import { useState } from 'react';
import { Trash2, Pencil, RotateCw, ShieldCheck } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { listRotationPolicies } from '@/api/vault/rotation';
import type { RotationStatus } from '@/api/vault/rotation';
import { deleteRotationPolicy, rotateCredentialNow, updateRotationPolicy } from '@/api/vault/rotation';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import { RotationCountdownRing } from './RotationCountdownRing';
import { useTranslation } from '@/i18n/useTranslation';

const ROTATION_STATUS = STATUS_COLORS.rotation!;

interface RotationActivePolicyProps {
  credentialId: string;
  rotationStatus: RotationStatus;
  rotationCountdown: string | null;
  isOAuth?: boolean;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
  onError: (message: string | null) => void;
}

export function RotationActivePolicy({
  credentialId,
  rotationStatus,
  rotationCountdown,
  isOAuth,
  onRefresh,
  onHealthcheck,
  onError,
}: RotationActivePolicyProps) {
  const { t, tx } = useTranslation();
  const [isRotating, setIsRotating] = useState(false);
  const [isRemovingPolicy, setIsRemovingPolicy] = useState(false);
  const [rotationDays, setRotationDays] = useState(rotationStatus.rotation_interval_days ?? (isOAuth ? 1 : 90));
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`w-4 h-4 ${rotationStatus.policy_enabled ? ROTATION_STATUS.text : 'text-foreground'}`} />
          <div className="text-sm">
            <span className={rotationStatus.policy_enabled ? `${ROTATION_STATUS.text} font-medium` : 'text-foreground'}>
              {rotationStatus.policy_enabled
                ? (isOAuth
                  ? (rotationStatus.policy_type === 'oauth_keepalive' ? t.vault.rotation_section.oauth_refresh_active_auto : t.vault.rotation_section.oauth_refresh_active)
                  : t.vault.rotation_section.auto_rotation_active)
                : t.vault.rotation_section.rotation_paused}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rotationCountdown && rotationStatus.policy_enabled && rotationStatus.next_rotation_at && rotationStatus.rotation_interval_days && (
            <RotationCountdownRing
              countdown={rotationCountdown}
              nextRotationAt={rotationStatus.next_rotation_at}
              intervalDays={rotationStatus.rotation_interval_days}
            />
          )}
          <Button
            variant="accent"
            size="sm"
            icon={<RotateCw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />}
            onClick={async () => {
              setIsRotating(true);
              onError(null);
              try {
                await rotateCredentialNow(credentialId);
                await onRefresh();
                onHealthcheck(credentialId);
              } catch (err) {
                onError(tx(t.vault.rotation_section.rotation_failed, { error: err instanceof Error ? err.message : 'Unknown error' }));
              } finally {
                setIsRotating(false);
              }
            }}
            disabled={isRotating}
            data-testid="rotation-rotate-now-btn"
            className={`hover:opacity-90 ${ROTATION_STATUS.bg} ${ROTATION_STATUS.border} ${ROTATION_STATUS.text}`}
          >
            Rotate Now
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            icon={isRemovingPolicy ? <LoadingSpinner size="xs" className="text-red-400/70" /> : <Trash2 className="w-3 h-3 text-red-400/50" />}
            onClick={async () => {
              setIsRemovingPolicy(true);
              onError(null);
              try {
                const allPolicies = await listRotationPolicies(credentialId);
                for (const p of allPolicies) {
                  await deleteRotationPolicy(p.id);
                }
                await onRefresh();
              } catch (err) {
                onError(tx(t.vault.rotation_section.remove_policy_failed, { error: err instanceof Error ? err.message : 'Unknown error' }));
              } finally {
                setIsRemovingPolicy(false);
              }
            }}
            disabled={isRemovingPolicy}
            data-testid="rotation-delete-policy-btn"
            title={t.vault.rotation_section.remove_policy_tooltip}
            className="hover:bg-red-500/10"
          />
        </div>
      </div>
      {/* Rotation period editor */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground">{t.vault.rotation_section.rotate_every}</span>
        {isEditingPeriod ? (
          <div className="flex items-center gap-1.5">
            <PillGroup
              options={(isOAuth ? [1, 7, 30, 90] : [30, 60, 90, 180]).map((d) => ({ value: d, label: `${d}d` }))}
              value={rotationDays}
              onChange={setRotationDays}
              layoutId={`rotation-edit-${credentialId}`}
              activeBg={ROTATION_STATUS.bg}
              activeText={ROTATION_STATUS.text}
              activeBorder={ROTATION_STATUS.border}
              customInput={
                <input
                  type="number"
                  value={rotationDays}
                  onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  min={1}
                  data-testid="rotation-days-input"
                  className="w-16 px-2 py-1 bg-transparent text-sm text-foreground text-center focus-visible:outline-none font-mono"
                />
              }
              data-testid="rotation-edit-presets"
            />
            <span className="text-sm text-foreground">{t.vault.rotation_section.days}</span>
            <Button
              variant="accent"
              size="xs"
              onClick={async () => {
                onError(null);
                try {
                  const allPolicies = await listRotationPolicies(credentialId);
                  if (allPolicies.length > 0) {
                    await updateRotationPolicy(allPolicies[0]!.id, { rotation_interval_days: rotationDays });
                  }
                  await onRefresh();
                  setIsEditingPeriod(false);
                } catch (err) {
                  onError(tx(t.vault.rotation_section.update_period_failed, { error: err instanceof Error ? err.message : 'Unknown error' }));
                }
              }}
              data-testid="rotation-save-period-btn"
              className={`hover:opacity-90 ${ROTATION_STATUS.bg} ${ROTATION_STATUS.border} ${ROTATION_STATUS.text}`}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setRotationDays(rotationStatus.rotation_interval_days ?? 90);
                setIsEditingPeriod(false);
              }}
              data-testid="rotation-cancel-period-btn"
              className="text-foreground hover:text-foreground/90"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            iconRight={<Pencil className="w-2.5 h-2.5 text-foreground ml-0.5" />}
            onClick={() => setIsEditingPeriod(true)}
            data-testid="rotation-edit-period-btn"
            className="bg-secondary/40 hover:bg-secondary/60 border border-primary/15 text-foreground"
          >
            <span className="font-mono">{rotationStatus.rotation_interval_days ?? 90}</span>
            <span>days</span>
          </Button>
        )}
      </div>
    </div>
  );
}
