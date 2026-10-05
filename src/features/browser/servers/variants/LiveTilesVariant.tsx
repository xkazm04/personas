/**
 * Server control prototype: Live tiles. WP0 PLACEHOLDER, replaced by its variant builder.
 * Owns presentation only; see `../serverVariantProps.ts`.
 */
import { useTranslation } from '@/i18n/useTranslation';

import type { ServerVariantProps } from '../serverVariantProps';

export default function LiveTilesVariant({ servers, onMenu, onToggle }: ServerVariantProps) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  return (
    <ul className="flex flex-col gap-1" data-testid="server-variant-placeholder-tiles">
      {servers.map((server) => (
        <li
          key={server.projectId}
          data-testid="server-item"
          data-project-id={server.projectId}
          data-state={server.state}
          onContextMenu={(e) => onMenu(e, server)}
          onDoubleClick={() => onToggle(server)}
          className="typo-body text-foreground"
        >
          {server.projectName} :{server.devPort} {s[`state_${server.state}`]}
        </li>
      ))}
    </ul>
  );
}
