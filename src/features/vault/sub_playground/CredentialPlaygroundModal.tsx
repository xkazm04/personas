import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, BarChart3, RotateCw, Globe, Server, Plug, Key, BookOpen } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { OverviewTab } from './tabs/OverviewTab';
import { ApiExplorerTab } from './tabs/ApiExplorerTab';
import { McpToolsTab } from './tabs/McpToolsTab';
import { CredentialIntelligence } from '@/features/vault/sub_features/CredentialIntelligence';
import { CredentialRotationSection } from '@/features/vault/sub_features/CredentialRotationSection';
import { CredentialRecipesTab } from './tabs/CredentialRecipesTab';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { useRotationTicker, formatCountdown } from '@/features/vault/hooks/useRotationTicker';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { CATALOG_API_ENDPOINTS } from '@/lib/credentials/catalogApiEndpoints';
import { getRotationStatus } from '@/api/rotation';
import type { RotationStatus } from '@/api/rotation';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

// ── Tab types ────────────────────────────────────────────────────

type PlaygroundTab = 'overview' | 'api-explorer' | 'recipes' | 'mcp-tools' | 'intelligence' | 'rotation';

interface TabDef {
  id: PlaygroundTab;
  label: string;
  icon: typeof Eye;
}

function getAvailableTabs(connector: ConnectorDefinition | undefined): TabDef[] {
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: Eye },
  ];

  const category = connector?.category;

  // API/PAT credentials: custom connections or catalog connectors with base_url fields
  if (category === 'custom' || (category && !['mcp', 'database'].includes(category))) {
    tabs.push({ id: 'api-explorer', label: 'API Explorer', icon: Globe });
    tabs.push({ id: 'recipes', label: 'Recipes', icon: BookOpen });
  }

  // MCP credentials
  if (category === 'mcp') {
    tabs.push({ id: 'mcp-tools', label: 'MCP Tools', icon: Server });
  }

  tabs.push(
    { id: 'intelligence', label: 'Intelligence', icon: BarChart3 },
    { id: 'rotation', label: 'Rotation', icon: RotateCw },
  );

  return tabs;
}

// ── Component ────────────────────────────────────────────────────

interface CredentialPlaygroundModalProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function CredentialPlaygroundModal({
  credential,
  connector,
  onClose,
  onDelete,
}: CredentialPlaygroundModalProps) {
  const tabs = useMemo(() => getAvailableTabs(connector), [connector]);
  const [activeTab, setActiveTab] = useState<PlaygroundTab>('overview');

  // ── Shared hooks ─────────────────────────────────────────────

  const [editError, setEditError] = useState<string | null>(null);
  const [rotationStatus, setRotationStatus] = useState<RotationStatus | null>(null);

  const health = useCredentialHealth(credential.id);
  const { result: healthcheckResult, isHealthchecking } = health;

  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at);

  const googleOAuth = useGoogleOAuth({
    onSuccess: () => setEditError(null),
    onError: (msg) => setEditError(msg),
  });

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
    } catch {
      // No rotation data yet
    }
  }, [credential.id]);

  useEffect(() => {
    fetchRotationStatus();
  }, [fetchRotationStatus]);

  const isGoogleOAuthFlow = connector
    ? isGoogleOAuthConnector(connector, credential.service_type)
    : false;

  const effectiveHealthcheckResult = useMemo(() =>
    healthcheckResult ?? (
      credential.healthcheck_last_success === null
        ? null
        : {
            success: credential.healthcheck_last_success,
            message: credential.healthcheck_last_message ?? 'Stored connection test result',
          }
    ), [healthcheckResult, credential.healthcheck_last_success, credential.healthcheck_last_message]);

  const handleOAuthConsent = useCallback((values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    setEditError(null);
    googleOAuth.startConsent(connector?.name || credential.service_type, extraScopes);
  }, [connector?.name, credential.service_type, googleOAuth]);

  // ── Keyboard ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Render ───────────────────────────────────────────────────

  const iconUrl = connector?.icon_url;
  const color = connector?.color || '#6B7280';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="relative w-full max-w-6xl h-[90vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20 shrink-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center border border-primary/15"
              style={{ backgroundColor: `${color}15` }}
            >
              {iconUrl ? (
                <ThemedConnectorIcon url={iconUrl} label={connector?.label || credential.name} color={color} size="w-5 h-5" />
              ) : connector ? (
                <Plug className="w-5 h-5" style={{ color }} />
              ) : (
                <Key className="w-5 h-5 text-emerald-400/80" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-foreground/90 truncate">
                {credential.name}
              </h2>
              <p className="text-sm text-muted-foreground/60">
                Credential Playground — {connector?.label || credential.service_type}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-6 pt-3 border-b border-primary/10 shrink-0">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-foreground/90'
                      : 'text-muted-foreground/50 hover:text-muted-foreground/70'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {isActive && (
                    <motion.div
                      layoutId="playgroundTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-full"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeTab === 'overview' && connector && (
              <OverviewTab
                credential={credential}
                connector={connector}
                isGoogleOAuthFlow={isGoogleOAuthFlow}
                googleOAuth={googleOAuth}
                effectiveHealthcheckResult={effectiveHealthcheckResult}
                isHealthchecking={isHealthchecking}
                health={health}
                rotationStatus={rotationStatus}
                rotationCountdown={rotationCountdown}
                fetchRotationStatus={fetchRotationStatus}
                editError={editError}
                setEditError={setEditError}
                onOAuthConsent={handleOAuthConsent}
                onDelete={onDelete}
              />
            )}
            {activeTab === 'overview' && !connector && (
              <div className="p-6 text-sm text-muted-foreground/80">
                No connector definition available for this credential type.
              </div>
            )}
            {activeTab === 'api-explorer' && (
              <ApiExplorerTab
                credentialId={credential.id}
                catalogEndpoints={connector ? CATALOG_API_ENDPOINTS[connector.name] : undefined}
              />
            )}
            {activeTab === 'recipes' && (
              <CredentialRecipesTab credentialId={credential.id} />
            )}
            {activeTab === 'mcp-tools' && (
              <McpToolsTab credentialId={credential.id} />
            )}
            {activeTab === 'intelligence' && (
              <div className="p-6">
                <CredentialIntelligence credentialId={credential.id} />
              </div>
            )}
            {activeTab === 'rotation' && (
              <div className="p-6">
                <CredentialRotationSection
                  credentialId={credential.id}
                  rotationStatus={rotationStatus}
                  rotationCountdown={rotationCountdown}
                  onRefresh={fetchRotationStatus}
                  onHealthcheck={() => health.checkStored()}
                />
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

