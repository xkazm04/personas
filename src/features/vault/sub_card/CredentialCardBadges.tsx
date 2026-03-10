import { RotateCw, Lock } from 'lucide-react';
import { RotationInsightBadge } from '@/features/vault/sub_card/badges/RotationInsightBadge';
import { OAuthActivityBadge } from '@/features/vault/sub_card/badges/OAuthActivityBadge';
import type { CredentialMetadata, ConnectorDefinition, ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/utils/authMethodStyles';
import { getCredentialTags, getTagStyle } from '@/features/vault/utils/credentialTags';
import type { RotationStatus } from '@/api/vault/rotation';
import { BadgeOverflowPill, type BadgeEntry } from './badges/BadgeOverflowPill';

/** Determine the single auth method actually used for this credential. */
function getAdoptedAuthMethod(credential: CredentialMetadata, connector: ConnectorDefinition): ConnectorAuthMethod | null {
  const methods = getAuthMethods(connector);
  if (methods.length <= 1) return methods[0] ?? null;
  const isMcp = credential.name.endsWith(' MCP') || credential.name.includes(' MCP ');
  if (isMcp) {
    return methods.find((m) => m.type === 'mcp') ?? methods[0] ?? null;
  }
  return methods.find((m) => m.is_default && m.type !== 'mcp')
    ?? methods.find((m) => m.type !== 'mcp')
    ?? methods[0]
    ?? null;
}

const MAX_INLINE = 1;

interface BadgeRowProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
}

export function BadgeRow({
  credential,
  connector,
  rotationStatus,
  rotationCountdown,
}: BadgeRowProps) {
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

  // Priority 2.5: OAuth activity
  if (credential.oauth_token_expires_at || credential.oauth_refresh_count > 0) {
    badges.push({
      key: 'oauth-activity',
      label: 'OAuth Activity',
      node: (
        <OAuthActivityBadge
          credentialId={credential.id}
          oauthRefreshCount={credential.oauth_refresh_count}
          oauthLastRefreshAt={credential.oauth_last_refresh_at}
          oauthTokenExpiresAt={credential.oauth_token_expires_at}
        />
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
      {overflow.length > 0 && <BadgeOverflowPill badges={overflow} />}
    </>
  );
}
