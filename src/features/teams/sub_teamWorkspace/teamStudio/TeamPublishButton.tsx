import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Share2, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { publishTeamAsPreset } from '@/api/agents/personas';
import { getInstallId, markActivation } from '@/lib/analytics';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Publish a team (multi-agent blueprint) to the public community-preset catalog
 * and surface its share URL. Mirrors {@link ShareAgentButton} — the "build →
 * share link" half of the viral loop, surfaced in the team studio header.
 *
 * The backend (`gallery_publish_preset`) serializes the team into a
 * credential-free blueprint (each member's `.persona.json` bundle already
 * excludes secrets) and returns the catalog slug; the canonical catalog URL is
 * `https://personas.ai/presets/<slug>`.
 */
export function TeamPublishButton({ teamId }: { teamId: string; teamName?: string }) {
  const { t } = useTranslation();
  const s = t.sharing;
  const [publishing, setPublishing] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // PresetPublishResult carries only the catalog slug; the canonical shareable
  // page is derived from the gallery base (production default personas.ai).
  const shareUrl = slug ? `https://personas.ai/presets/${slug}` : '';

  const handlePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const r = await publishTeamAsPreset(teamId, null, getInstallId());
      setSlug(r.slug);
      setOpen(true);
      markActivation('shared');
    } catch (err) {
      toastCatch('TeamPublishButton:publish', s.team_publish_failed)(err);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        loading={publishing}
        icon={<Share2 className="w-3.5 h-3.5" />}
        onClick={slug ? () => setOpen((o) => !o) : handlePublish}
        data-testid="team-publish-btn"
      >
        {s.team_publish_button}
      </Button>

      <AnimatePresence>
        {open && slug && (
          <motion.div
            // eslint-disable-next-line custom/enforce-base-modal -- anchored share popover, not a centered modal
            role="dialog"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-80 bg-background border border-primary/15 rounded-card shadow-elevation-3 p-3 z-50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="typo-heading text-foreground">{s.team_publish_title}</p>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
                aria-label={t.common.dismiss}
                className="w-6 h-6"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-secondary/40 border border-primary/10 rounded-input px-2 py-1.5 typo-body text-foreground"
                data-testid="team-publish-url"
              />
              <CopyButton text={shareUrl} label={t.common.copy} />
            </div>
            <p className="mt-2 typo-caption text-foreground">{s.team_publish_hint}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
