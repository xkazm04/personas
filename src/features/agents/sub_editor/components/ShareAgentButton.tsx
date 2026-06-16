import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Share2, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { publishPersonaToGallery } from '@/api/agents/personas';
import type { GalleryPublishResult } from '@/lib/bindings/GalleryPublishResult';
import { getInstallId, markActivation } from '@/lib/analytics';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * @catalog Share an agent to the public gallery and surface its share link.
 *
 * Publishes the persona as a `.persona.json` bundle to the web gallery and shows
 * the resulting `personas.ai/p/<slug>` link to copy — the "create → share link"
 * half of the viral loop, surfaced where agents are edited (not buried in
 * Settings). Records the `shared` activation milestone on first publish.
 */
export function ShareAgentButton({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const s = t.agents.share;
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<GalleryPublishResult | null>(null);
  const [open, setOpen] = useState(false);
  // The referral code is this install's pseudonymous id; whoever installs from
  // this link gets the referrer credited on their first activation.
  const inviteUrl = `https://personas.ai/?ref=${getInstallId()}`;

  const handleShare = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const r = await publishPersonaToGallery(personaId, null, getInstallId());
      setResult(r);
      setOpen(true);
      markActivation('shared');
    } catch (err) {
      toastCatch('ShareAgentButton:publish', s.failed)(err);
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
        onClick={result ? () => setOpen((o) => !o) : handleShare}
        data-testid="agent-share-btn"
      >
        {s.button}
      </Button>

      <AnimatePresence>
        {open && result && (
          <motion.div
            role="dialog"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-80 bg-background border border-primary/15 rounded-card shadow-elevation-3 p-3 z-50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="typo-heading text-foreground">{s.published}</p>
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
                value={result.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-secondary/40 border border-primary/10 rounded-input px-2 py-1.5 typo-body text-foreground"
                data-testid="agent-share-url"
              />
              <CopyButton text={result.url} label={t.common.copy} />
            </div>
            <p className="mt-2 typo-caption text-foreground">{s.hint}</p>

            {/* Invite a friend to Personas (referral) — credited when they install. */}
            <div className="mt-3 pt-3 border-t border-primary/10">
              <p className="mb-1.5 typo-caption text-foreground">{s.invite_hint}</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 bg-secondary/40 border border-primary/10 rounded-input px-2 py-1.5 typo-body text-foreground"
                  data-testid="invite-url"
                />
                <CopyButton text={inviteUrl} label={t.common.copy} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
