import { useCallback } from 'react';
import { Pencil, Globe, Filter } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useVaultStore } from '@/stores/vaultStore';
import { usePostSaveResourcePicker } from '@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker';
import { useTranslation } from '@/i18n/useTranslation';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface CredentialScopeSectionProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition;
}

/**
 * Read-only view of `scoped_resources` per declared `ResourceSpec`, with an
 * "Edit scope" button that re-opens the same picker the catalog uses on save.
 *
 * Three states per spec:
 *   - broad scope (no entry in scopedResources OR empty array) — shown as
 *     "Broad — all resources"
 *   - explicit picks — chips listing each pick's label
 *   - skipped (`scopedResources === {}`) — same as broad
 */
export function CredentialScopeSection({ credential, connector }: CredentialScopeSectionProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const { editScope } = usePostSaveResourcePicker();

  const specs = connector.resources ?? [];
  const scope = credential.scopedResources;

  const handleEdit = useCallback(async () => {
    await editScope({
      credentialId: credential.id,
      serviceType: credential.service_type,
      initial: scope,
    });
    void fetchCredentials();
  }, [editScope, credential.id, credential.service_type, scope, fetchCredentials]);

  if (specs.length === 0) return null;

  return (
    <div className="border border-primary/10 rounded-modal p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-foreground" />
          <span className="typo-body font-medium text-foreground">{sh.scope_section_title}</span>
        </div>
        <Button
          onClick={handleEdit}
          variant="ghost"
          size="xs"
          icon={<Pencil className="w-3.5 h-3.5" />}
          className="text-foreground hover:text-foreground"
        >
          {sh.scope_edit}
        </Button>
      </div>

      <div className="space-y-3">
        {specs.map((spec) => {
          const picks = scope?.[spec.id] ?? [];
          const isBroad = picks.length === 0;
          return (
            <div key={spec.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="typo-caption font-medium text-foreground">
                  {spec.label}
                </span>
                {spec.required && isBroad && (
                  <span className="typo-caption text-status-warning">{sh.scope_required_missing}</span>
                )}
              </div>
              {isBroad ? (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-input bg-secondary/30 border border-foreground/10">
                  <Globe className="w-3 h-3 text-foreground" />
                  <span className="typo-caption text-foreground">{sh.scope_broad}</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {picks.map((p) => (
                    <span
                      key={p.id}
                      title={p.sublabel ?? p.id}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-input bg-primary/10 border border-primary/20 typo-caption text-foreground"
                    >
                      <span className="truncate max-w-[18ch]">{p.label}</span>
                      {p.sublabel && (
                        <span className="text-foreground truncate max-w-[14ch]">
                          · {p.sublabel}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
