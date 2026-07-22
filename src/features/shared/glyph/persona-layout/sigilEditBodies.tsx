import type { ReactNode } from 'react';
import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import type { Translations } from '@/i18n/en';
import { interpolate } from '@/i18n/useTranslation';

interface SigilBodyArgs {
  /** The capability the modal is editing. */
  uc: DisplayUseCase;
  /** Active translations, threaded so this read-only body renders localized copy. */
  t: Translations;
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
export function resolveSigilEditBody(dim: GlyphDimension, { uc, t }: SigilBodyArgs): ReactNode {
  const c = t.agents;
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
      if (!label) return inactiveBody(c.sigil_edit_no_trigger);
      return (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label uppercase tracking-wider text-foreground">{c.sigil_edit_when_label}</span>
          <span className="typo-body-lg text-foreground">{label}</span>
        </div>
      );
    }

    case 'connector': {
      if (!uc.connectorKey && !uc.connector) {
        return inactiveBody(c.sigil_edit_no_connector);
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
              {key ? interpolate(c.sigil_edit_service_label, { key }) : c.sigil_edit_custom_connector}
            </span>
          </div>
        </div>
      );
    }

    case 'message': {
      const channels = uc.notificationChannels;
      if (channels.length === 0) {
        return inactiveBody(c.sigil_edit_no_channels);
      }
      return (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label uppercase tracking-wider text-foreground">{c.sigil_edit_channels_label}</span>
          <ul className="flex flex-col gap-1">
            {channels.map((ch, i) => (
              <li key={`${ch}-${i}`} className="typo-body-lg text-foreground">{ch}</li>
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
        memory: { on: c.sigil_edit_memory_on, off: c.sigil_edit_memory_off },
        review: { on: c.sigil_edit_review_on, off: c.sigil_edit_review_off },
        event: { on: c.sigil_edit_event_on, off: c.sigil_edit_event_off },
        error: { on: c.sigil_edit_error_on, off: c.sigil_edit_error_off },
      };
      const copy = labels[dim];
      return (
        <p className="typo-body text-foreground leading-relaxed">
          {active ? copy.on : copy.off}
        </p>
      );
    }

    default:
      return inactiveBody(c.sigil_edit_no_dim_editor);
  }
}

function inactiveBody(text: string): ReactNode {
  return (
    <p className="typo-body text-foreground italic">
      {text}
    </p>
  );
}
