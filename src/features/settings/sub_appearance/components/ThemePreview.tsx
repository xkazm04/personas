import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Mini preview — shows derived colors in a miniature app
// ---------------------------------------------------------------------------

// Keys whose change should trigger a preview crossfade.
const PREVIEW_KEYS = [
  '--background',
  '--foreground',
  '--primary',
  '--accent',
  '--secondary',
  '--border',
  '--muted-foreground',
  '--card-bg',
  '--card-border',
  '--btn-primary',
  '--background-gradient',
  '--status-success',
  '--status-warning',
  '--status-error',
] as const;

export function ThemePreview({ vars }: { vars: Record<string, string> }) {
  const { t } = useTranslation();
  const bg = vars['--background'];
  const fg = vars['--foreground'];
  const primary = vars['--primary'];
  const accent = vars['--accent'];
  const secondary = vars['--secondary'];
  const border = vars['--border'];
  const muted = vars['--muted-foreground'];
  const cardBg = vars['--card-bg'];
  const cardBorder = vars['--card-border'];
  const btnPrimary = vars['--btn-primary'];
  const gradient = vars['--background-gradient'];

  // Hash of every visible colour; its settled value drives the AnimatePresence crossfade.
  const hash = useMemo(
    () => PREVIEW_KEYS.map((k) => vars[k] ?? '').join('|'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...PREVIEW_KEYS.map((k) => vars[k])],
  );

  // The crossfade is keyed by a SETTLED hash: while a colour is being dragged the hash changes on
  // every tick, and keying by it mounted a new preview tree per tick (each kept alive for its exit).
  // The layer keeps painting the live colours; it only crossfades once the colours stop changing.
  const [fadeKey, setFadeKey] = useState(hash);
  useEffect(() => {
    const id = setTimeout(() => setFadeKey(hash), 160);
    return () => clearTimeout(id);
  }, [hash]);

  return (
    <div
      className="relative rounded-modal overflow-hidden border"
      style={{ borderColor: border, color: fg, minHeight: 120 }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={fadeKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-0 flex"
          style={{
            backgroundColor: bg,
            backgroundImage: gradient ?? 'none',
          }}
        >
          {/* Sidebar mock */}
          <div
            className="w-12 flex-shrink-0 flex flex-col items-center gap-2 py-3 border-r"
            style={{ backgroundColor: secondary, borderColor: border }}
          >
            <div className="w-5 h-5 rounded-input" style={{ backgroundColor: primary, opacity: 0.9 }} />
            <div className="w-5 h-5 rounded-input" style={{ backgroundColor: fg, opacity: 0.08 }} />
            <div className="w-5 h-5 rounded-input" style={{ backgroundColor: fg, opacity: 0.08 }} />
          </div>

          {/* Main area */}
          <div className="flex-1 p-3 space-y-2.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: primary }} />
                <span className="typo-caption" style={{ color: fg }}>{t.settings.appearance.preview_dashboard}</span>
              </div>
              <div
                className="px-2 py-0.5 rounded-input text-[9px] font-medium"
                style={{ backgroundColor: btnPrimary, color: '#fff' }}
              >
                {t.settings.appearance.preview_action}
              </div>
            </div>

            {/* Card mock */}
            <div
              className="rounded-card p-2.5 space-y-1.5 border"
              style={{ backgroundColor: cardBg, borderColor: cardBorder }}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
                <span className="text-[10px] font-medium" style={{ color: fg }}>{t.settings.appearance.preview_card_title}</span>
              </div>
              <div className="h-px" style={{ backgroundColor: border }} />
              <span className="text-[9px] block" style={{ color: muted }}>
                {t.settings.appearance.preview_muted_text}
              </span>
            </div>

            {/* Status dots */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-success'] }} />
                <span className="text-[8px]" style={{ color: muted }}>{t.settings.appearance.preview_ok}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-warning'] }} />
                <span className="text-[8px]" style={{ color: muted }}>{t.settings.appearance.preview_warn}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-error'] }} />
                <span className="text-[8px]" style={{ color: muted }}>{t.settings.appearance.preview_err}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
