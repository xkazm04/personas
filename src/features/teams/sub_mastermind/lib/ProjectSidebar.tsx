// Project sidebar — slides from the right border on a project-header click.
// Round-5 content: the Passport wall's project column (CoverBody header + the
// dimension sections in Focus ink) — it fits the width well; scenario-specific
// content layers come in a later round.
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { CoverBody, IMPROVABLE_ROWS, InkWallCell } from '@/features/teams/sub_factory/passport/ProjectsPassportWall';
import { ImproveCell } from '@/features/teams/sub_factory/passport/improve/ImproveCell';
import { SECTIONS } from '@/features/teams/sub_factory/passport/passportRows';
import { SectionIcon } from '@/features/teams/sub_factory/passport/passportWidgets';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';

export function ProjectSidebar({ passport, name, onClose }: {
  passport: AppPassport | null;
  /** Island name — fallback header for demo islands without a passport. */
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Headline rows live on the cover already — mirror the wall's filtering.
  const bodySections = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: 'linear' }}
      className="absolute top-0 right-0 bottom-0 w-[320px] z-20 bg-secondary/95 backdrop-blur-sm border-l border-primary/15 shadow-elevation-4 overflow-y-auto"
      data-testid="mm-project-sidebar"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-secondary/95 border-b border-primary/10">
        <span className="typo-label text-foreground/90">{t.mastermind.passport_title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.mastermind.sidebar_close}
          className="ml-auto p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-sidebar-close"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="px-4 py-3">
        {passport ? (
          <>
            <CoverBody p={passport} openable={false} attention={[]} stats={null} />
            {bodySections.map((section) => (
              <div key={section.key} className="mt-5">
                {/* dividers run brighter than the wall's — the secondary panel
                    backdrop swallows the wall's primary/[0.06] hairlines */}
                <div className="flex items-center gap-1.5 pb-1.5 border-b border-foreground/20">
                  <SectionIcon name={section.icon} className="w-3.5 h-3.5 text-primary/70" />
                  <span className="typo-label text-foreground/70">{section.label}</span>
                </div>
                {section.rows.map((row) => {
                  const cell = <InkWallCell value={row.get(passport)} />;
                  return (
                    <div key={row.key} className="py-2 border-t border-foreground/12 first:border-t-0">
                      <span className="block typo-caption text-foreground/55 mb-1">{row.label}</span>
                      {/* same actionable setup machinery as the Passport wall —
                          ImproveCell renders plain when nothing is applicable;
                          its popovers clamp/flip against the window, so the
                          right-edge sidebar stays safe. */}
                      {IMPROVABLE_ROWS.has(row.key) ? (
                        <ImproveCell slug={passport.identity.slug} rowKey={row.key} passport={passport}>{cell}</ImproveCell>
                      ) : (
                        cell
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        ) : (
          <>
            <span className="typo-heading-lg tracking-tight block">{name}</span>
            <p className="typo-caption text-foreground/55 mt-2">{t.mastermind.passport_demo}</p>
          </>
        )}
      </div>
    </motion.aside>
  );
}
