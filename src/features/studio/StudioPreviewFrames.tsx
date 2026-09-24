import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guide/guideCopy';
import type { StudioPreviewState } from './useStudioPreview';

// Warm previews (every live tab stays mounted; only the active one is shown)
// plus the A3 orb pointer over the element a question is about. Shared by both
// Studio layouts; the caller positions it (it fills its nearest positioned box).
export default function StudioPreviewFrames({
  preview,
  showPointer = true,
}: {
  preview: StudioPreviewState;
  showPointer?: boolean;
}) {
  const { t } = useTranslation();
  const { previewUrls, previewRoutes, iframeNonces, activeId, active, live, pointerRect } = preview;
  // Which frame instances (tab + reload nonce) have finished their first load.
  // A dev server's first page can take seconds to compile; until it lands the
  // frame shows a calm ghost instead of a blank white page (loading pattern v2:
  // a ghost only while something is really loading, delayed so a warm load
  // never flashes it).
  const [loaded, setLoaded] = useState<Record<string, true>>({});
  const activeKey = activeId && previewUrls[activeId] ? `${activeId}-${iframeNonces[activeId] ?? 0}` : null;
  return (
    <>
      {Object.keys(previewUrls).map((id) => {
        const route = previewRoutes[id] ?? '/';
        const nonce = iframeNonces[id] ?? 0;
        const isActive = id === activeId;
        return (
          <iframe
            key={`${id}-${nonce}`}
            data-tab={id}
            onLoad={() => setLoaded((m) => (m[`${id}-${nonce}`] ? m : { ...m, [`${id}-${nonce}`]: true }))}
            src={`${previewUrls[id]}${route === '/' ? '' : route}`}
            title={isActive ? 'preview' : `preview-${id}`}
            aria-hidden={!isActive}
            // `inert` removes a hidden warm preview from focus AND the a11y tree;
            // opacity/pointer-events alone left it reachable by the Tab key.
            {...(isActive ? {} : { inert: true, tabIndex: -1 })}
            className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-200 ${
              isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
        );
      })}
      {activeKey && !loaded[activeKey] && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.25 }}
          className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-4 bg-background p-10"
        >
          <div className="h-10 w-full rounded-interactive bg-secondary/40" />
          <div className="h-40 w-2/3 rounded-card bg-secondary/30" />
          <div className="grid flex-1 grid-cols-3 gap-4">
            <div className="rounded-card bg-secondary/25" />
            <div className="rounded-card bg-secondary/25" />
            <div className="rounded-card bg-secondary/25" />
          </div>
          <p className="typo-caption text-foreground/90">{guideStrings(t).preview_loading}</p>
        </motion.div>
      )}
      {showPointer && live && active?.question && pointerRect ? (
        <div
          data-testid="studio-orb-pointer"
          className="pointer-events-none absolute z-20 rounded-lg ring-2 ring-primary transition-all duration-300"
          style={{ left: pointerRect.x, top: pointerRect.y, width: pointerRect.width, height: pointerRect.height }}
        >
          <span className="absolute -right-2.5 -top-2.5 flex h-7 w-7 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/25 ring-2 ring-primary backdrop-blur">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </span>
          </span>
        </div>
      ) : showPointer && live && active?.question && active.decisionArea ? (
        <div
          className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 ${
            active.decisionArea === 'top' ? 'top-16' : active.decisionArea === 'bottom' ? 'bottom-32' : 'top-1/2 -translate-y-1/2'
          }`}
        >
          <span className="relative flex h-9 w-9 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/25 ring-2 ring-primary backdrop-blur">
              <Bot className="h-4 w-4 text-primary" />
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}
