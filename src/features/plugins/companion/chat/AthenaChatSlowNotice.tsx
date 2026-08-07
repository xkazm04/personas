/**
 * AthenaChatSlowNotice — the "is this thing stuck?" reassurance chip.
 *
 * If no CLI line has arrived for ~30s we surface a gentle "still working"
 * hint; at ~2min it sharpens to suggest the Stop control. The hard timeout is
 * 15min server-side (`TURN_TIMEOUT` in `session.rs`), which is far too long to
 * leave someone staring at a static bubble.
 *
 * Owns its own interval + state so the 5s tick re-renders this chip alone
 * rather than the whole chat body.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CHAT_EASE } from './athenaChatMorph';

const SOFT_MS = 30_000;
const FIRM_MS = 120_000;
/** Fine-grained enough to appear within a heartbeat of a threshold, cheap enough to poll. */
const POLL_MS = 5000;

export function AthenaChatSlowNotice({
  streaming,
  lastStreamEventAtRef,
}: {
  streaming: boolean;
  lastStreamEventAtRef: React.MutableRefObject<number>;
}) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (!streaming) {
      setLevel(0);
      return;
    }
    const id = window.setInterval(() => {
      const since = Date.now() - lastStreamEventAtRef.current;
      setLevel(since > FIRM_MS ? 2 : since > SOFT_MS ? 1 : 0);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [streaming, lastStreamEventAtRef]);

  return (
    <AnimatePresence>
      {level > 0 && (
        <motion.div
          key="companion-slow-progress"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: CHAT_EASE }}
          className={`flex items-center gap-2 rounded-card border px-3 py-1.5 typo-caption ${
            level === 2
              ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300'
              : 'border-foreground/10 bg-foreground/[0.04] text-foreground'
          }`}
          data-testid="companion-slow-progress"
          data-slow-level={level}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>
            {level === 2
              ? t.plugins.companion.slow_progress_firm
              : t.plugins.companion.slow_progress_soft}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
