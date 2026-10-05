/**
 * A pin's tech stack: brand icons through the shared `TechIconStrip`, and the
 * token text standing in when no token resolves to an icon (the strip itself
 * drops unmatched tokens, so a Python-only repo would otherwise show nothing).
 */
import { useMemo } from 'react';

import { TechIconStrip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { techTokens } from '../../serverModel';

export default function TechMarks({ server, max = 4 }: { server: DevServerView; max?: number }) {
  const tokens = useMemo(() => techTokens(server), [server]);
  const anyIcon = useMemo(() => tokens.some((tok) => resolveTechIcon(tok) != null), [tokens]);
  if (tokens.length === 0) return null;
  if (!anyIcon) return <span className="typo-caption text-foreground truncate">{tokens.join(', ')}</span>;
  return <TechIconStrip techStack={server.techStack} max={max} />;
}
