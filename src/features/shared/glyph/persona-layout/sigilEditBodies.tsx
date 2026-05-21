import type { ReactNode } from 'react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface SigilBodyArgs {
  /** The capability the modal is editing. */
  uc: DisplayUseCase;
}

/**
 * Resolve a read-only body for the SigilEditModal based on the active
 * dim + the capability under edit. Each branch shows what the
 * capability has saved for that dim today; editing is the next slice
 * (Phase 3b). The toggle in the modal footer is the only write path
 * that lands in this iteration.
 *
 * The "active iff" rules mirror the migration spec's per-dim defaults
 * (see docs/development/template-sigil-migration.md §3): if the
 * capability's source field is populated, the dim is active.
 */
export function resolveSigilEditBody(dim: GlyphDimension, { uc }: SigilBodyArgs): ReactNode {
  switch (dim) {
    case 'task':
      return (
        <div className="flex flex-col gap-2">
          <span className="typo-body-lg text-foreground">{uc.title}</span>
          {uc.description && (
            <p className="typo-body text-foreground leading-relaxed">
              {uc.description}
            </p>
          )}
        </div>
      );

    case 'trigger': {
      const label = uc.triggerLabel?.trim();
      if (!label) return inactiveBody('No trigger configured on this capability.');
      return (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label uppercase tracking-wider text-foreground">When</span>
          <span className="typo-body-lg text-foreground">{label}</span>
        </div>
      );
    }

    case 'connector': {
      if (!uc.connectorKey && !uc.connector) {
        return inactiveBody('This capability does not declare a connector.');
      }
      const key = uc.connectorKey;
      const meta = key ? getConnectorMeta(key) : null;
      return (
        <div className="flex items-center gap-3">
          {meta ? (
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-input bg-foreground/5 border border-card-border/40">
              <ConnectorIcon meta={meta} size="w-6 h-6" />
            </span>
          ) : null}
          <div className="flex flex-col">
            <span className="typo-body-lg text-foreground">{meta?.label ?? uc.connector}</span>
            <span className="typo-caption text-foreground">
              {key ? `Service: ${key}` : 'Custom connector — no brand icon match.'}
            </span>
          </div>
        </div>
      );
    }

    case 'message': {
      const channels = uc.notificationChannels;
      if (channels.length === 0) {
        return inactiveBody('No notification channels for this capability.');
      }
      return (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label uppercase tracking-wider text-foreground">Channels</span>
          <ul className="flex flex-col gap-1">
            {channels.map((c, i) => (
              <li key={`${c}-${i}`} className="typo-body-lg text-foreground">{c}</li>
            ))}
          </ul>
        </div>
      );
    }

    case 'memory':
    case 'review':
    case 'event':
    case 'error': {
      const active = uc.dimensions.includes(dim);
      const labels: Record<typeof dim, { on: string; off: string }> = {
        memory: { on: 'Persistent memory is on for this capability.', off: 'Memory is off — the capability runs stateless.' },
        review: { on: 'Human review is required before this capability acts.', off: 'No human review gate — actions are autonomous.' },
        event: { on: 'This capability subscribes to events.', off: 'No event subscriptions configured.' },
        error: { on: 'Custom error-handling policy is configured.', off: 'Falls back to the default error policy.' },
      };
      const copy = labels[dim];
      return (
        <p className="typo-body text-foreground leading-relaxed">
          {active ? copy.on : copy.off}
        </p>
      );
    }

    default:
      return inactiveBody('No editor wired for this dim yet.');
  }
}

function inactiveBody(text: string): ReactNode {
  return (
    <p className="typo-body text-foreground italic">
      {text}
    </p>
  );
}
