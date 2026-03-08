import { useState } from 'react';
import { Key, Wrench, Zap, Pencil, BarChart3, RotateCw, Tag, X, Plus, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { CredentialEventConfig } from '@/features/vault/sub_features/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/sub_features/CredentialIntelligence';
import { CredentialRotationSection } from '@/features/vault/sub_features/CredentialRotationSection';
import { getTagStyle } from '@/features/vault/utils/credentialTags';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { RotationStatus } from '@/api/rotation';
import type { HealthResult } from '@/features/vault/hooks/useCredentialHealth';
import { useCredentialTags } from '@/features/vault/hooks/useCredentialTags';

type ExpandedSection = 'services' | 'events' | 'intelligence' | 'rotation' | null;

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
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const {
    currentTags,
    tagInput,
    showTagInput,
    showSuggestions,
    filteredSuggestions,
    tagInputRef,
    copiedCredentialId,
    addTag,
    removeTag,
    copyCredentialId,
    startTagInput,
    onTagInputChange,
    onTagInputKeyDown,
    onTagInputBlur,
  } = useCredentialTags(credential);

  return (
    <div className="space-y-3">
      {/* Primary actions -- always visible */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => health.checkStored()}
          disabled={isHealthchecking}
          className="flex items-center gap-1.5 px-4 py-2 min-h-[36px] bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
        >
          {isHealthchecking ? (
            <div className="w-3.5 h-3.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Key className="w-3.5 h-3.5" />
          )}
          Test
        </button>
        <button
          onClick={onStartEditing}
          className="flex items-center gap-1.5 px-4 py-2 min-h-[36px] bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-xl text-sm font-medium transition-all"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>

      {/* Tags row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Tag className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        {currentTags.map((tag) => {
          const style = getTagStyle(tag);
          return (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 text-sm font-medium px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:opacity-70 transition-opacity"
                title={`Remove tag "${tag}"`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          );
        })}
        {showTagInput ? (
          <div className="relative">
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => onTagInputChange(e.target.value)}
              onKeyDown={(e) => onTagInputKeyDown(e.key)}
              onBlur={onTagInputBlur}
              autoFocus
              placeholder="Add tag..."
              className="w-20 text-sm px-1.5 py-0.5 rounded border border-primary/20 bg-background/50 text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 z-20 bg-background border border-primary/15 rounded-lg shadow-lg py-1 min-w-[100px]">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                    className="w-full text-left px-2.5 py-1 text-sm hover:bg-secondary/50 transition-colors text-foreground/80"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={startTagInput}
            className="inline-flex items-center gap-0.5 text-sm text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            title="Add tag"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        )}
        <button
          onClick={copyCredentialId}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/10 bg-secondary/20 text-sm text-muted-foreground/70 hover:text-foreground/80 transition-colors"
          title="Copy credential ID"
        >
          <span className="font-mono">id</span>
          {copiedCredentialId ? (
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.15 }}
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            </motion.div>
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Secondary actions -- segmented tab bar */}
      <div className="flex items-center gap-1 border-b border-primary/10">
        {([
          { key: 'intelligence' as const, icon: BarChart3, label: 'Intelligence', show: true },
          { key: 'rotation' as const, icon: RotateCw, label: 'Rotation', show: true, badge: rotationStatus?.anomaly_score && rotationStatus.anomaly_score.remediation !== 'healthy' },
          { key: 'services' as const, icon: Wrench, label: `Services (${connector.services.length})`, show: connector.services.length > 0 },
          { key: 'events' as const, icon: Zap, label: `Events (${connector.events.length})`, show: connector.events.length > 0 },
        ] as const).filter((t) => t.show).map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setExpandedSection(expandedSection === tab.key ? null : tab.key);
              if (tab.key === 'rotation' && expandedSection !== 'rotation') fetchRotationStatus();
            }}
            className={`relative flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-sm font-medium transition-colors ${
              expandedSection === tab.key
                ? 'text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground/80 hover:bg-secondary/25'
            }`}
          >
            <tab.icon className="w-3 h-3" />
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
          </button>
        ))}
      </div>

      {/* Healthcheck result */}
      {(() => {
        if (!effectiveHealthcheckResult) return null;
        return (
          <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm ${
            effectiveHealthcheckResult.success
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            <span className="font-semibold">{effectiveHealthcheckResult.success ? 'OK' : 'FAIL'}:</span>
            <span>{effectiveHealthcheckResult.message}</span>
          </div>
        );
      })()}

      {/* Field keys listing */}
      {connector.fields.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {connector.fields.map((f) => (
            <span key={f.key} className="text-sm px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-muted-foreground/60 font-mono">
              {f.key}
            </span>
          ))}
        </div>
      )}

      {/* Section content */}
      {expandedSection && (
        <div className="bg-secondary/10 border border-primary/6 rounded-xl p-4">
          {expandedSection === 'services' && (
            <div className="space-y-2">
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
          {expandedSection === 'events' && (
            <CredentialEventConfig credentialId={credential.id} events={connector.events} />
          )}
          {expandedSection === 'intelligence' && (
            <CredentialIntelligence credentialId={credential.id} />
          )}
          {expandedSection === 'rotation' && (
            <CredentialRotationSection
              credentialId={credential.id}
              rotationStatus={rotationStatus}
              rotationCountdown={rotationCountdown}
              isOAuth={
                (credential.oauth_token_expires_at != null) ||
                (credential.oauth_refresh_count > 0)
              }
              onRefresh={fetchRotationStatus}
              onHealthcheck={() => health.checkStored()}
            />
          )}
        </div>
      )}
    </div>
  );
}
