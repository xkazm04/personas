import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Key, Plug, RotateCw, Lock } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { RotationInsightBadge } from '@/features/vault/sub_card/RotationInsightBadge';
import type { CredentialMetadata, ConnectorDefinition, ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/utils/authMethodStyles';
import { getCredentialTags, getTagStyle } from '@/features/vault/utils/credentialTags';
import { formatTimestamp } from '@/lib/utils/formatters';
import type { RotationStatus } from '@/api/rotation';
import type { HealthResult } from '@/features/vault/hooks/useCredentialHealth';
import { computeHealthScore, getTierStyle } from '@/features/vault/utils/credentialHealthScore';

/** Determine the single auth method actually used for this credential. */
function getAdoptedAuthMethod(credential: CredentialMetadata, connector: ConnectorDefinition): ConnectorAuthMethod | null {
  const methods = getAuthMethods(connector);
  if (methods.length <= 1) return methods[0] ?? null;
  // Credentials created via MCP have " MCP" appended to the name
  const isMcp = credential.name.endsWith(' MCP') || credential.name.includes(' MCP ');
  if (isMcp) {
    return methods.find((m) => m.type === 'mcp') ?? methods[0] ?? null;
  }
  // Otherwise return the default or first non-MCP method
  return methods.find((m) => m.is_default && m.type !== 'mcp')
    ?? methods.find((m) => m.type !== 'mcp')
    ?? methods[0]
    ?? null;
}

export interface CredentialCardHeaderProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  effectiveHealthcheckResult: HealthResult | null;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  onSelect: () => void;
  onDelete: (id: string) => void;
}

export function CredentialCardHeader({
  credential,
  connector,
  effectiveHealthcheckResult,
  rotationStatus,
  rotationCountdown,
  onSelect,
  onDelete,
}: CredentialCardHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="w-full px-3 py-2.5 cursor-pointer hover:bg-secondary/50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-inset focus-visible:outline-none rounded-xl"
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border"
            style={{
              backgroundColor: connector ? `${connector.color}15` : undefined,
              borderColor: connector ? `${connector.color}30` : undefined,
            }}
          >
            {connector?.icon_url ? (
              <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-4 h-4" />
            ) : connector ? (
              <Plug className="w-4 h-4" style={{ color: connector.color }} />
            ) : (
              <Key className="w-4 h-4 text-emerald-400/80" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="font-medium text-foreground text-sm truncate max-w-[220px] sm:max-w-[320px]">
                {credential.name}
              </h4>
              <CompositeHealthDot
                healthResult={effectiveHealthcheckResult}
                rotationStatus={rotationStatus}
              />
              <BadgeRow
                credential={credential}
                connector={connector}
                rotationStatus={rotationStatus}
                rotationCountdown={rotationCountdown}
              />
            </div>

            <div className="mt-1 text-sm text-muted-foreground/90">
              Created {formatTimestamp(credential.created_at, 'Never')} · Last used {formatTimestamp(credential.last_used_at, 'Never')}
              {credential.healthcheck_last_tested_at && (
                <> · Last tested {formatTimestamp(credential.healthcheck_last_tested_at, 'Never')}</>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(credential.id);
            }}
            className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete credential"
          >
            <Trash2 className="w-4 h-4 text-red-400/70" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Composite health dot ─────────────────────────────────────────

function CompositeHealthDot({
  healthResult,
  rotationStatus,
}: {
  healthResult: HealthResult | null;
  rotationStatus: RotationStatus | null;
}) {
  const composite = useMemo(
    () => computeHealthScore(healthResult, rotationStatus),
    [healthResult, rotationStatus],
  );
  const style = getTierStyle(composite.tier);

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dotColor}`}
      title={`${style.label} (${composite.score}/100) — ${composite.reason}`}
    />
  );
}

// ── Badge priority system ────────────────────────────────────────

interface BadgeEntry {
  key: string;
  label: string;
  node: ReactNode;
}

const MAX_INLINE = 1;

function BadgeRow({
  credential,
  connector,
  rotationStatus,
  rotationCountdown,
}: {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
}) {
  // Build priority-ordered badge list (highest priority first)
  const badges: BadgeEntry[] = [];

  // Priority 1: anomaly
  if (rotationStatus?.anomaly_score && rotationStatus.anomaly_score.remediation !== 'healthy') {
    badges.push({
      key: 'anomaly',
      label: 'Anomaly',
      node: (
        <RotationInsightBadge
          anomalyScore={rotationStatus.anomaly_score}
          consecutiveFailures={rotationStatus.consecutive_failures}
        />
      ),
    });
  }

  // Priority 2: rotation countdown
  if (rotationStatus?.policy_enabled && rotationCountdown) {
    badges.push({
      key: 'rotation',
      label: `Rotation: ${rotationCountdown}`,
      node: (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex-shrink-0">
          <RotateCw className="w-2.5 h-2.5 text-cyan-400/70" />
          <span className="text-sm text-cyan-400/70 font-mono">{rotationCountdown}</span>
        </span>
      ),
    });
  }

  // Priority 3: auth method
  if (connector) {
    const adopted = getAdoptedAuthMethod(credential, connector);
    if (adopted) {
      badges.push({
        key: 'auth',
        label: adopted.label,
        node: (
          <span className={`text-sm px-1.5 py-0.5 rounded-lg font-mono border shrink-0 ${getAuthBadgeClasses(adopted)}`}>
            {adopted.label}
          </span>
        ),
      });
    }
  } else {
    badges.push({
      key: 'service',
      label: credential.service_type,
      node: (
        <span className="text-sm px-1.5 py-0.5 rounded-lg font-mono border shrink-0 bg-secondary/40 border-primary/15 text-muted-foreground/60">
          {credential.service_type}
        </span>
      ),
    });
  }

  // Priority 4: field count
  if (connector && connector.fields.length > 0) {
    const count = connector.fields.length;
    badges.push({
      key: 'fields',
      label: `${count} field${count !== 1 ? 's' : ''}`,
      node: (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-muted-foreground/50 shrink-0">
          <Lock className="w-2.5 h-2.5" />
          <span className="text-sm font-medium">{count} field{count !== 1 ? 's' : ''}</span>
        </span>
      ),
    });
  }

  // Priority 5: tags
  for (const tag of getCredentialTags(credential)) {
    const style = getTagStyle(tag);
    badges.push({
      key: `tag-${tag}`,
      label: tag,
      node: (
        <span className={`text-sm font-medium px-1.5 py-0.5 rounded border shrink-0 ${style.bg} ${style.text} ${style.border}`}>
          {tag}
        </span>
      ),
    });
  }

  const inline = badges.slice(0, MAX_INLINE);
  const overflow = badges.slice(MAX_INLINE);

  return (
    <>
      {inline.map((b) => <span key={b.key}>{b.node}</span>)}
      {overflow.length > 0 && <OverflowPill badges={overflow} />}
    </>
  );
}

function OverflowPill({ badges }: { badges: BadgeEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="text-sm font-medium px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-muted-foreground/60 hover:text-muted-foreground/80 hover:border-primary/20 transition-colors shrink-0"
      >
        +{badges.length}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-1.5 z-30 min-w-[160px] rounded-lg bg-background border border-primary/15 shadow-xl py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {badges.map((b) => (
              <div key={b.key} className="flex items-center gap-2 px-3 py-1">
                {b.node}
                <span className="text-sm text-muted-foreground/70">{b.label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
