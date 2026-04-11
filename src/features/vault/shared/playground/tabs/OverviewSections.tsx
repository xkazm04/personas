import { useState } from 'react';
import { Wrench, Zap, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { CredentialEventConfig } from '@/features/vault/sub_credentials/components/features/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/sub_credentials/components/features/CredentialIntelligence';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface OverviewSectionsProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition;
  onDelete: (id: string) => void;
}

export function OverviewSections({ credential, connector, onDelete }: OverviewSectionsProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [expandedSection, setExpandedSection] = useState<'services' | 'events' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      {/* Delete action */}
      <div className="flex items-center">
        <div className="ml-auto">
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-400/80">{sh.delete_credential_confirm}</span>
              <Button
                onClick={() => onDelete(credential.id)}
                variant="danger"
                size="sm"
                className="bg-red-500/15 hover:bg-red-500/25 border-red-500/25 text-red-400"
              >
                {sh.confirm}
              </Button>
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                variant="secondary"
                size="sm"
                className="text-foreground/70"
              >
                {t.common.cancel}
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="ghost"
              size="icon-sm"
              title={sh.delete_credential}
              icon={<Trash2 className="w-4 h-4 text-red-400/50 hover:text-red-400/80" />}
            />
          )}
        </div>
      </div>

      {/* Collapsible sections: Services and Events */}
      {connector.services.length > 0 && (
        <div className="border border-primary/10 rounded-xl overflow-hidden">
          <Button
            onClick={() => setExpandedSection(expandedSection === 'services' ? null : 'services')}
            variant="ghost"
            size="md"
            block
            icon={<Wrench className="w-3.5 h-3.5 text-muted-foreground/60" />}
            iconRight={expandedSection === 'services' ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
            className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-none"
          >
            <span className="text-sm font-medium text-foreground/80 flex-1">{tx(sh.services, { count: connector.services.length })}</span>
          </Button>
          {expandedSection === 'services' && (
            <div className="px-4 pb-3 space-y-2">
              {connector.services.map((service) => (
                <div
                  key={service.toolName}
                  className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/10 rounded-xl border-l-2"
                  style={{ borderLeftColor: connector.color || 'transparent' }}
                >
                  <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <div>
                    <span className="text-sm text-foreground/80">{service.label}</span>
                    <span className="ml-2 text-sm font-mono text-muted-foreground/60">{service.toolName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {connector.events.length > 0 && (
        <div className="border border-primary/10 rounded-xl overflow-hidden">
          <Button
            onClick={() => setExpandedSection(expandedSection === 'events' ? null : 'events')}
            variant="ghost"
            size="md"
            block
            icon={<Zap className="w-3.5 h-3.5 text-muted-foreground/60" />}
            iconRight={expandedSection === 'events' ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
            className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-none"
          >
            <span className="text-sm font-medium text-foreground/80 flex-1">{tx(sh.events, { count: connector.events.length })}</span>
          </Button>
          {expandedSection === 'events' && (
            <div className="px-4 pb-3">
              <CredentialEventConfig credentialId={credential.id} events={connector.events} />
            </div>
          )}
        </div>
      )}

      {/* Intelligence */}
      <div className="border border-primary/10 rounded-xl p-4">
        <CredentialIntelligence credentialId={credential.id} />
      </div>
    </>
  );
}
