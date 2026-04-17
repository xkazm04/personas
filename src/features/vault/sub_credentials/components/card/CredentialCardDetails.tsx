import { useState } from 'react';
import { Key, Wrench, Zap, Pencil, BarChart3, RotateCw, Timer, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { useCredentialTags } from '@/features/vault/shared/hooks/useCredentialTags';
import { Button } from '@/features/shared/components/buttons';
import { CredentialTagsRow } from './CredentialTagsRow';
import { CredentialSectionContent } from './CredentialSectionContent';
import { useTranslation } from '@/i18n/useTranslation';

type ExpandedSection = 'services' | 'events' | 'intelligence' | 'rotation' | 'token_lifetime' | 'audit' | null;

export interface CredentialCardDetailsProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition;
  effectiveHealthcheckResult: HealthResult | null;
  isHealthchecking: boolean;
  health: {
    checkStored: () => void;
  };
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  fetchRotationStatus: () => Promise<void>;
  onStartEditing: () => void;
}

export function CredentialCardDetails({
  credential,
  connector,
  effectiveHealthcheckResult,
  isHealthchecking,
  health,
  rotationStatus,
  rotationCountdown,
  fetchRotationStatus,
  onStartEditing,
}: CredentialCardDetailsProps) {
  const { t, tx } = useTranslation();
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const tags = useCredentialTags(credential);

  return (
    <div className="space-y-3">
      {/* Primary actions -- always visible */}
      <div className="flex items-center gap-2">
        <Button
          variant="accent"
          size="md"
          icon={isHealthchecking ? (
            <div className="w-3.5 h-3.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Key className="w-3.5 h-3.5" />
          )}
          onClick={() => health.checkStored()}
          disabled={isHealthchecking}
          className="min-h-[36px] bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-400"
        >
          {t.common.test}
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<Pencil className="w-3.5 h-3.5" />}
          onClick={onStartEditing}
          className="min-h-[36px] bg-secondary/60 hover:bg-secondary border-primary/15 text-foreground/90"
        >
          {t.common.edit}
        </Button>
      </div>

      {/* Tags row */}
      <CredentialTagsRow tags={tags} />

      {/* Secondary actions -- segmented tab bar */}
      <div className="flex items-center gap-1 border-b border-primary/10">
        {([
          { key: 'intelligence' as const, icon: BarChart3, label: t.vault.card_details.tab_intelligence, show: true },
          { key: 'rotation' as const, icon: RotateCw, label: t.vault.card_details.tab_rotation, show: true, badge: rotationStatus?.anomaly_score && rotationStatus.anomaly_score.remediation !== 'healthy' },
          { key: 'token_lifetime' as const, icon: Timer, label: t.vault.card_details.tab_token_lifetime, show: (credential.oauth_token_expires_at != null) || (credential.oauth_refresh_count > 0) },
          { key: 'services' as const, icon: Wrench, label: tx(t.vault.card_details.tab_services, { count: connector.services.length }), show: connector.services.length > 0 },
          { key: 'events' as const, icon: Zap, label: tx(t.vault.card_details.tab_events, { count: connector.events.length }), show: connector.events.length > 0 },
          { key: 'audit' as const, icon: Shield, label: t.vault.card_details.tab_audit, show: true },
        ] as const).filter((t) => t.show).map((tab) => (
          <Button
            key={tab.key}
            variant="ghost"
            size="sm"
            icon={<tab.icon className="w-3 h-3" />}
            onClick={() => {
              setExpandedSection(expandedSection === tab.key ? null : tab.key);
              if (tab.key === 'rotation' && expandedSection !== 'rotation') fetchRotationStatus();
            }}
            className={`relative min-h-[38px] ${
              expandedSection === tab.key
                ? 'text-foreground'
                : 'text-foreground hover:text-foreground/80 hover:bg-secondary/25'
            }`}
          >
            {tab.label}
            {'badge' in tab && tab.badge && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
            {expandedSection === tab.key && (
              <motion.div
                layoutId={`tab-indicator-${credential.id}`}
                className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              />
            )}
          </Button>
        ))}
      </div>

      {/* Healthcheck result */}
      {effectiveHealthcheckResult && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-modal typo-body ${
          effectiveHealthcheckResult.success
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          <span className="font-semibold">{effectiveHealthcheckResult.success ? 'OK' : 'FAIL'}:</span>
          <span>{effectiveHealthcheckResult.message}</span>
        </div>
      )}

      {/* Field keys listing */}
      {connector.fields.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {connector.fields.map((f) => (
            <span key={f.key} className="typo-code px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-foreground font-mono">
              {f.key}
            </span>
          ))}
        </div>
      )}

      {/* Section content */}
      {expandedSection && (
        <CredentialSectionContent
          expandedSection={expandedSection}
          credential={credential}
          connector={connector}
          rotationStatus={rotationStatus}
          rotationCountdown={rotationCountdown}
          fetchRotationStatus={fetchRotationStatus}
          onHealthcheck={() => health.checkStored()}
        />
      )}
    </div>
  );
}
