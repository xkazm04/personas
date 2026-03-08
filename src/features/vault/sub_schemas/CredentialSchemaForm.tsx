import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { usePersonaStore } from '@/stores/personaStore';
import type { SchemaFormConfig } from './schemaFormTypes';
import { sanitize } from './schemaFormTypes';
import { ExtraFieldRenderer } from './ExtraFieldRenderers';

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

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const deleteConnectorDefinition = usePersonaStore((s) => s.deleteConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const health = useCredentialHealth(config.healthKey);

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

      await createCredential({
        name: `${effectiveName} Credential`,
        service_type: serviceType,
        data: credData,
      });

      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      onComplete();
    } catch (err) {
      // Rollback: if we created a connector but credential creation failed,
      // delete the orphan connector to avoid inconsistent state.
      if (createdConnectorId) {
        try {
          await deleteConnectorDefinition(createdConnectorId);
        } catch { /* intentional: non-critical — rollback is best-effort */ }
      }
      setError(err instanceof Error ? err.message : `Failed to save ${config.title.toLowerCase()}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {showHeader && (
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {config.headerIcon}
          <div>
            <h3 className="text-sm font-semibold text-foreground">{config.title}</h3>
            <p className="text-sm text-muted-foreground/60">{config.subtitle}</p>
          </div>
        </div>
      )}

      {!nameOverride && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            {config.nameLabel} <span className="text-red-400 ml-1">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={config.namePlaceholder}
            className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
          />
        </div>
      )}

      {config.subTypes.length > 1 && (
        <div>
          <label className="block text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
            {config.subTypeLabel}
          </label>

          {config.subTypeLayout === 'flex' ? (
            <>
              <div className="flex gap-2">
                {config.subTypes.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => handleSubTypeChange(st.id)}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      subTypeId === st.id
                        ? config.subTypeActiveClass
                        : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
                    }`}
                  >
                    {st.displayLabel ?? st.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground/60">{activeSubType.description}</p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {config.subTypes.map((st) => (
                <button
                  key={st.id}
                  onClick={() => handleSubTypeChange(st.id)}
                  className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-all ${
                    subTypeId === st.id
                      ? config.subTypeActiveClass
                      : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
                  }`}
                >
                  <div className="font-medium text-sm flex items-center gap-2">
                    {st.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />}
                    {st.label}
                  </div>
                  <div className="text-sm text-muted-foreground/50 mt-0.5">{st.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
        <p className="text-sm text-muted-foreground/50 italic">{activeSubType.noHealthcheckHint}</p>
      )}

      {config.extraFields?.map((ef) => (
        <ExtraFieldRenderer key={ef.key} def={ef} state={extraState} setState={setExtraState} />
      ))}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </motion.div>
  );
}
