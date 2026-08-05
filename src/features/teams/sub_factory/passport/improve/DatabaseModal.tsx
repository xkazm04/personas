// Database dimension — the modal behind the passport's Database cell.
//
// Shape follows SkillsWorkbench (the operator's reference): BaseModal, a header
// band carrying icon + title + project, a fixed body height so nothing resizes
// on interaction, and a footer strip. What it holds is the three environments
// side by side, each an `EnvConnectorSlot`.
//
// The Database row previously fell through to the generic DeployPopover, which
// could only offer a Claude deploy action — it could show what the codebase had
// but the operator could not say "production is THIS Neon project". That
// declaration is what the modal adds; the detected half stays read-only,
// because it is a fact about the code and not the operator's to edit here.
import { Database } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';

import { ENV_KEYS, ENV_LABEL, type AppPassport } from '../passportModel';
import { EnvConnectorSlot } from './EnvConnectorSlot';
import { bindingKey, DATABASE_SERVICE_TYPES, useEnvConnectors } from './envConnectors';

/** The passport row key this modal owns — also the `dimension` its bindings are
 *  stored under. */
export const DATABASE_DIMENSION = 'persistence';

export function DatabaseModal({ slug, projectName, passport, onClose }: {
  slug: string;
  projectName: string;
  passport: AppPassport;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const env = useEnvConnectors(slug, DATABASE_SERVICE_TYPES);

  const slots = passport.stack.environments?.db;
  // Pre-env-split passports have no `environments` block; the legacy
  // single-value persistence list describes the local tier, so it fills that
  // slot rather than leaving the whole row blank.
  const legacyLocal = passport.stack.persistence
    .map((p) => (p.orm ? `${p.engine ?? p.kind} (${p.orm})` : (p.engine ?? p.kind)))
    .join(' · ') || null;

  return (
    <BaseModal isOpen onClose={onClose} titleId="database-modal-title" size="lg" portal staggerChildren={false}>
      <div className="flex flex-col h-[420px]" data-testid="database-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <Database className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="database-modal-title" className="typo-title truncate">{d.database_modal_title}</span>
          <span className="typo-caption text-foreground/70 truncate">· {projectName}</span>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 p-4">
          {ENV_KEYS.map((key) => {
            const slot = slots?.[key];
            const boundId = env.bindings.get(bindingKey(DATABASE_DIMENSION, key));
            return (
              <EnvConnectorSlot
                key={key}
                env={key}
                envLabel={ENV_LABEL[key]}
                detected={slot ? slot.label : (key === 'local' ? legacyLocal : null)}
                detectedSub={slot?.sub}
                bound={env.credentialById(boundId)}
                boundHealth={boundId ? env.health[boundId] : undefined}
                candidates={env.credentials}
                health={env.health}
                busy={env.saving === bindingKey(DATABASE_DIMENSION, key)}
                onAssign={(credentialId) => { void env.assign(DATABASE_DIMENSION, key, credentialId); }}
              />
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <span className="typo-label text-foreground/35">{d.database_modal_footer}</span>
        </div>
      </div>
    </BaseModal>
  );
}
