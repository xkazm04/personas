import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Eye, RotateCw, Globe, Server, BookOpen, History } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { useGoogleOAuth } from '@/features/vault/shared/hooks/useGoogleOAuth';
import { useRotationTicker, formatCountdown } from '@/features/vault/shared/hooks/useRotationTicker';
import { isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';
import { getRotationStatus } from '@/api/vault/rotation';
import type { RotationStatus } from '@/api/vault/rotation';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { PlaygroundHeader } from './PlaygroundHeader';
import { PlaygroundTabContent } from './PlaygroundTabContent';

type PlaygroundTab = 'overview' | 'executions' | 'api-explorer' | 'recipes' | 'mcp-tools' | 'rotation';
interface TabDef { id: PlaygroundTab; label: string; icon: typeof Eye; }

function getAvailableTabs(connector: ConnectorDefinition | undefined): TabDef[] {
  const tabs: TabDef[] = [{ id: 'overview', label: 'Overview', icon: Eye }];
  tabs.push({ id: 'executions', label: 'Executions', icon: History });
  const category = connector?.category;
  if (category === 'custom' || (category && !['mcp', 'database'].includes(category))) {
    tabs.push({ id: 'api-explorer', label: 'API Explorer', icon: Globe });
    tabs.push({ id: 'recipes', label: 'Recipes', icon: BookOpen });
  }
  if (category === 'mcp') tabs.push({ id: 'mcp-tools', label: 'MCP Tools', icon: Server });
  tabs.push({ id: 'rotation', label: 'Rotation', icon: RotateCw });
  return tabs;
}

interface CredentialPlaygroundModalProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function CredentialPlaygroundModal({ credential, connector, onClose, onDelete }: CredentialPlaygroundModalProps) {
  const tabs = useMemo(() => getAvailableTabs(connector), [connector]);
  const [activeTab, setActiveTab] = useState<PlaygroundTab>('overview');
  const [editError, setEditError] = useState<string | null>(null);
  const [rotationStatus, setRotationStatus] = useState<RotationStatus | null>(null);

  const health = useCredentialHealth(credential.id);
  const { result: healthcheckResult, isHealthchecking } = health;
  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at) ?? '';

  const googleOAuth = useGoogleOAuth({ onSuccess: () => setEditError(null), onError: (msg) => setEditError(msg) });

  const fetchRotationStatus = useCallback(async () => {
    try { const status = await getRotationStatus(credential.id); setRotationStatus(status); } catch { /* intentional */ }
  }, [credential.id]);

  useEffect(() => { fetchRotationStatus(); }, [fetchRotationStatus]);

  const isGoogleOAuthFlow = connector ? isGoogleOAuthConnector(connector, credential.service_type) : false;

  const effectiveHealthcheckResult = useMemo(() =>
    healthcheckResult ?? (credential.healthcheck_last_success === null ? null : {
      success: credential.healthcheck_last_success,
      message: credential.healthcheck_last_message ?? 'Stored connection test result',
    }), [healthcheckResult, credential.healthcheck_last_success, credential.healthcheck_last_message]);

  const handleOAuthConsent = useCallback((values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim() ? values.scopes.trim().split(/\s+/) : undefined;
    setEditError(null);
    googleOAuth.startConsent(connector?.name || credential.service_type, extraScopes);
  }, [connector?.name, credential.service_type, googleOAuth]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="credential-playground-title" size="6xl" portal panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden h-[90vh]">
      <PlaygroundHeader credential={credential} connector={connector} onClose={onClose} />
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-primary/10 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon; const isActive = tab.id === activeTab;
          return (
            <Button key={tab.id} variant="ghost" size="sm"
              icon={<Icon className="w-3.5 h-3.5" />}
              onClick={() => setActiveTab(tab.id)}
              className={`relative ${isActive ? 'text-foreground/90' : 'text-foreground hover:text-muted-foreground/70'}`}>
              {tab.label}
              {isActive && <motion.div layoutId="playgroundTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-full" transition={{ type: 'spring', stiffness: 500, damping: 30 }} />}
            </Button>
          );
        })}
      </div>
      <PlaygroundTabContent
        activeTab={activeTab} credential={credential} connector={connector}
        isGoogleOAuthFlow={isGoogleOAuthFlow} googleOAuth={googleOAuth}
        effectiveHealthcheckResult={effectiveHealthcheckResult} isHealthchecking={isHealthchecking}
        health={health} rotationStatus={rotationStatus} rotationCountdown={rotationCountdown}
        fetchRotationStatus={fetchRotationStatus} editError={editError} setEditError={setEditError}
        onOAuthConsent={handleOAuthConsent} onDelete={onDelete}
      />
    </BaseModal>
  );
}
