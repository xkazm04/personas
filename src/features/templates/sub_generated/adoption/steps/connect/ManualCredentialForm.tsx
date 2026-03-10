/**
 * ManualForm — manual credential entry form for InlineCredentialPanel.
 */
import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bot, ExternalLink } from 'lucide-react';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/hooks/health/useCredentialHealth';
import { usePersonaStore } from '@/stores/personaStore';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';
import type { RequiredConnector } from './ConnectStep';

export function ManualForm({
  connectorName,
  connectorDef,
  credentialFields,
  setupUrl,
  setupInstructions,
  designResult,
  onSetCredential,
  onCredentialCreated,
  onSaveSuccess,
  onClose,
  onSwitchToAuto,
}: {
  connectorName: string;
  connectorDef: ConnectorDefinition | undefined;
  credentialFields?: RequiredConnector['credential_fields'];
  setupUrl?: string;
  setupInstructions?: string;
  designResult: CredentialDesignResult | null;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onCredentialCreated: () => void;
  onSaveSuccess?: (connectorName: string, credentialName: string) => void;
  onClose: () => void;
  onSwitchToAuto?: () => void;
}) {
  const meta = getConnectorMeta(connectorName);

  const inlineFields = useMemo<CredentialTemplateField[]>(() => {
    if (designResult?.connector.fields?.length) {
      return designResult.connector.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));
    }
    if (connectorDef?.fields?.length) {
      return connectorDef.fields;
    }
    if (credentialFields?.length) {
      return credentialFields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
      }));
    }
    return [];
  }, [designResult, connectorDef, credentialFields]);

  const credentialName = designResult
    ? `${designResult.connector.label} credential`
    : `${meta.label} credential`;

  const effectiveSetupUrl =
    (connectorDef?.metadata as Record<string, unknown>)?.docs_url as string | undefined ?? setupUrl;
  const effectiveSetupInstructions = connectorDef
    ? undefined
    : designResult?.setup_instructions || setupInstructions;

  const health = useCredentialHealth(`connector:${connectorName}`);

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      if (designResult) {
        await health.checkDesign(
          `Test connection for ${designResult.connector.label}`,
          designResult.connector as unknown as Record<string, unknown>,
          values,
        );
      } else {
        await health.checkDesign(
          `Test connection for ${meta.label} connector`,
          { name: connectorName, label: meta.label, fields: inlineFields },
          values,
        );
      }
    },
    [connectorName, meta.label, inlineFields, designResult, health.checkDesign],
  );

  const handleSave = useCallback(
    async (values: Record<string, string>) => {
      const store = usePersonaStore.getState();

      if (designResult && !designResult.match_existing) {
        const conn = designResult.connector;
        await store.createConnectorDefinition({
          name: conn.name,
          label: conn.label,
          category: conn.category,
          color: conn.color,
          fields: JSON.stringify(conn.fields),
          healthcheck_config: JSON.stringify(conn.healthcheck_config ?? null),
          services: JSON.stringify(conn.services || []),
          events: JSON.stringify(conn.events || []),
          metadata: JSON.stringify({
            template_enabled: true,
            setup_instructions: designResult.setup_instructions,
            summary: designResult.summary,
          }),
          is_builtin: false,
        });
      }

      const serviceType = designResult?.match_existing || designResult?.connector.name || connectorName;
      const credId = await store.createCredential({
        name: credentialName,
        service_type: serviceType,
        data: values,
      });
      if (credId) {
        onCredentialCreated();
        onSetCredential(connectorName, credId);
        onSaveSuccess?.(connectorName, credentialName);
        onClose();
      }
    },
    [connectorName, credentialName, designResult, onCredentialCreated, onSetCredential, onSaveSuccess, onClose],
  );

  const canAutoSetup = !!(designResult?.setup_instructions);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
    >
      {canAutoSetup && onSwitchToAuto && (
        <button
          onClick={onSwitchToAuto}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors text-left"
        >
          <Bot className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-cyan-300">Auto-Setup available</p>
            <p className="text-sm text-muted-foreground/50">Let browser automation fill these fields for you</p>
          </div>
        </button>
      )}

      {effectiveSetupUrl && (
        <a
          href={effectiveSetupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-sm text-foreground/80 hover:bg-amber-500/15 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          <span className="flex-1 truncate">Get your credentials</span>
        </a>
      )}

      {effectiveSetupInstructions && (
        <div className="px-3 py-2 mb-3 bg-secondary/40 border border-primary/8 rounded-xl">
          <p className="text-sm text-muted-foreground/70 whitespace-pre-line leading-relaxed">
            {effectiveSetupInstructions}
          </p>
        </div>
      )}

      {inlineFields.length > 0 ? (
        <CredentialEditForm
          fields={inlineFields}
          onSave={handleSave}
          onCancel={onClose}
          onHealthcheck={handleHealthcheck}
          isHealthchecking={health.isHealthchecking}
          healthcheckResult={health.result}
          onValuesChanged={() => health.invalidate()}
          saveDisabled={!health.result?.success}
          saveDisabledReason="Run a successful connection test before saving."
        />
      ) : (
        <div className="text-sm text-muted-foreground/50 text-center py-3">
          No credential fields defined. Try <span className="text-violet-400">Design with AI</span> to discover the required fields.
        </div>
      )}
    </motion.div>
  );
}
