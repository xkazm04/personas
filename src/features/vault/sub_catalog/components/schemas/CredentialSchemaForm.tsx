import { useState, useCallback } from 'react';
import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { useVaultStore } from "@/stores/vaultStore";
import { usePostSaveResourcePicker } from '@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker';
import type { SchemaFormConfig } from './schemaFormTypes';
import { sanitize } from './schemaFormTypes';
import { ExtraFieldRenderer } from './ExtraFieldRenderers';
import { SchemaFormHeader, SchemaNameField, SchemaSubTypeSelector } from './SchemaFormFields';

// Re-export types and configs for backwards compatibility
export type { SchemaSubType, ExtraFieldDef, SchemaFormConfig } from './schemaFormTypes';
export { MCP_SCHEMA, CUSTOM_SCHEMA, DATABASE_SCHEMA } from './schemaConfigs';

interface CredentialSchemaFormProps {
  config: SchemaFormConfig;
  onBack: () => void;
  onComplete: () => void;
  defaultSubType?: string;
  initialValues?: Record<string, string>;
  initialExtras?: Record<string, unknown>;
  nameOverride?: string;
  serviceTypeOverride?: string;
  showHeader?: boolean;
}

export function CredentialSchemaForm({
  config,
  onBack,
  onComplete,
  defaultSubType,
  initialValues,
  initialExtras,
  nameOverride,
  serviceTypeOverride,
  showHeader = true,
}: CredentialSchemaFormProps) {
  const [name, setName] = useState('');
  const [subTypeId, setSubTypeId] = useState(defaultSubType ?? config.subTypes[0]!.id);
  const [error, setError] = useState<string | null>(null);
  const [extraState, setExtraState] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const ef of config.extraFields ?? []) {
      switch (ef.kind) {
        case 'textarea': init[ef.key] = ''; break;
        case 'checkbox': init[ef.key] = false; break;
        case 'key-value-list': init[ef.key] = []; break;
      }
    }
    return { ...init, ...initialExtras };
  });

  const createCredential = useVaultStore((s) => s.createCredential);
  const createConnectorDefinition = useVaultStore((s) => s.createConnectorDefinition);
  const deleteConnectorDefinition = useVaultStore((s) => s.deleteConnectorDefinition);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);
  const health = useCredentialHealth(config.healthKey);
  // Picker dispatch — global <ResourcePickerHost /> renders the modal so it
  // survives this form's unmount on `onComplete()` after save.
  const { promptIfScoped } = usePostSaveResourcePicker();

  const activeSubType = (config.subTypes.find((st) => st.id === subTypeId) ?? config.subTypes[0])!;
  const hasHealthcheck = !!activeSubType.healthcheck || !!config.customHealthcheck;

  const handleSubTypeChange = useCallback((id: string) => {
    setSubTypeId(id);
    health.invalidate();
  }, [health.invalidate]);

  const handleHealthcheck = useCallback(async (fieldValues: Record<string, string>) => {
    if (config.customHealthcheck) {
      await health.check(async () => {
        const result = await config.customHealthcheck!(subTypeId, fieldValues, extraState);
        return { success: result.success, message: result.message };
      });
      return;
    }
    if (!activeSubType.healthcheck) return;
    const hcConfig = activeSubType.healthcheck(fieldValues);
    if (!hcConfig) return;
    const serviceType = serviceTypeOverride
      ?? `${config.serviceTypePrefix}_${sanitize(nameOverride ?? (name.trim() || config.title))}`;
    await health.checkDesign(
      nameOverride ?? (name.trim() || config.title),
      { name: serviceType, healthcheck_config: hcConfig },
      fieldValues,
    );
  }, [activeSubType, config.customHealthcheck, config.serviceTypePrefix, config.title, subTypeId, extraState, name, nameOverride, serviceTypeOverride, health.checkDesign, health.check]);

  const handleSave = async (fieldValues: Record<string, string>) => {
    const effectiveName = nameOverride ?? name.trim();
    if (!nameOverride && !name.trim()) {
      setError(`${config.nameLabel} is required`);
      return;
    }
    setError(null);

    let createdConnectorId: string | null = null;
    try {
      const serviceType = serviceTypeOverride ?? `${config.serviceTypePrefix}_${sanitize(effectiveName)}`;
      const connColor = activeSubType.color ?? config.connectorColor;

      const fields = activeSubType.fields.map((f) => ({
        key: f.key, label: f.label, type: f.type,
        required: f.required ?? false, placeholder: f.placeholder,
        helpText: f.helpText, options: f.options,
      }));

      const hcConfig = activeSubType.healthcheck?.(fieldValues) ?? null;

      const metadata: Record<string, unknown> = {
        [config.subTypeMetadataKey]: subTypeId,
        template_enabled: false,
        ...(config.buildExtraMetadata?.(subTypeId, extraState) ?? {}),
      };

      const connector = await createConnectorDefinition({
        name: serviceType,
        label: effectiveName,
        color: connColor,
        category: config.category,
        fields: JSON.stringify(fields),
        healthcheck_config: hcConfig ? JSON.stringify(hcConfig) : null,
        services: JSON.stringify([]),
        events: JSON.stringify([]),
        metadata: JSON.stringify(metadata),
        is_builtin: false,
      });
      createdConnectorId = connector.id;

      const credData = config.buildExtraCredData
        ? { ...fieldValues, ...config.buildExtraCredData(subTypeId, extraState) }
        : fieldValues;

      const newCredId = await createCredential({
        name: `${effectiveName} Credential`,
        service_type: serviceType,
        data: credData,
        healthcheck_passed: health.result?.success === true,
      });

      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);

      // Prompt for scope if the connector declares resources[]. The picker
      // is rendered globally; list errors surface inline. No-op when there
      // are no resources, so safe to call unconditionally.
      await promptIfScoped({ credentialId: newCredId, serviceType });

      onComplete();
    } catch (err) {
      if (createdConnectorId) {
        try {
          await deleteConnectorDefinition(createdConnectorId);
        } catch { /* intentional: non-critical -- rollback is best-effort */ }
      }
      setError(err instanceof Error ? err.message : `Failed to save ${config.title.toLowerCase()}`);
    }
  };

  return (
    <div
      className="animate-fade-slide-in space-y-4"
      data-testid="vault-schema-form"
    >
      {showHeader && <SchemaFormHeader config={config} onBack={onBack} />}

      {!nameOverride && (
        <SchemaNameField
          name={name}
          onNameChange={setName}
          nameLabel={config.nameLabel}
          namePlaceholder={config.namePlaceholder}
          error={error}
        />
      )}

      <SchemaSubTypeSelector
        config={config}
        subTypeId={subTypeId}
        activeSubType={activeSubType}
        onSubTypeChange={handleSubTypeChange}
      />

      <div className="border-t border-primary/8" />
      <CredentialEditForm
        fields={activeSubType.fields}
        initialValues={initialValues}
        onSave={handleSave}
        onCancel={onBack}
        onHealthcheck={hasHealthcheck ? handleHealthcheck : undefined}
        isHealthchecking={health.isHealthchecking}
        healthcheckResult={health.result}
        testHint={activeSubType.testHint}
      />

      {!hasHealthcheck && activeSubType.noHealthcheckHint && (
        <p className="typo-body text-foreground italic">{activeSubType.noHealthcheckHint}</p>
      )}

      {config.extraFields?.map((ef) => (
        <ExtraFieldRenderer key={ef.key} def={ef} state={extraState} setState={setExtraState} />
      ))}

      {error && <p id="schema-form-error" role="alert" className="typo-body text-red-400">{error}</p>}
    </div>
  );
}
