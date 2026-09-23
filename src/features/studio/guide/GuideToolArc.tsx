import { useState } from 'react';
import { motion } from 'framer-motion';
import { Columns3, Database, Footprints, Monitor, Pencil, Search, Volume2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { GUIDE_TOOLS, type GuideTool, type GuideToolId } from './guideModel';

const ICONS: Record<GuideToolId, typeof Search> = {
  research: Search,
  looks: Columns3,
  devices: Monitor,
  tour: Footprints,
  tweak: Pencil,
  data: Database,
  read: Volume2,
};

// Athena's tools fan out in an arc above the orb (O, or a click on the orb).
// 1-7 or the arrows + Enter pick; Esc closes. Each tool says what it does and
// why it is unavailable when it is.
export default function GuideToolArc({
  unavailable,
  onPick,
  onClose,
}: {
  /** Tool id -> the reason it cannot run right now. */
  unavailable: Partial<Record<GuideToolId, string>>;
  onPick: (tool: GuideTool) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const g = t.studio.guide;
  const { shouldAnimate } = useMotion();
  const [focus, setFocus] = useState(0);
  const label: Record<GuideToolId, [string, string]> = {
    research: [g.tool_research, g.tool_research_what],
    looks: [g.tool_looks, g.tool_looks_what],
    devices: [g.tool_devices, g.tool_devices_what],
    tour: [g.tool_tour, g.tool_tour_what],
    tweak: [g.tool_tweak, g.tool_tweak_what],
    data: [g.tool_data, g.tool_data_what],
    read: [g.tool_read, g.tool_read_what],
  };
  const pick = (i: number) => {
    const tool = GUIDE_TOOLS[i];
    if (tool && !unavailable[tool.id]) onPick(tool);
  };

  // An overlay over the whole stage: it takes every key while open (exclusive),
  // so a digit picks a tool here and never also answers a card underneath.
  useAppKeyboard(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const n = Number(e.key);
      if (e.key === 'Escape') onClose();
      else if (Number.isInteger(n) && n >= 1 && n <= GUIDE_TOOLS.length) pick(n - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setFocus((f) => (f + 1) % GUIDE_TOOLS.length);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setFocus((f) => (f - 1 + GUIDE_TOOLS.length) % GUIDE_TOOLS.length);
      else if (e.key === 'Enter') pick(focus);
      else return false;
      e.preventDefault();
      return true;
    },
    { priority: OVERLAY_DISMISS_PRIORITY, exclusive: true },
  );

  const focused = GUIDE_TOOLS[focus]!;
  const n = GUIDE_TOOLS.length;
  return (
    <div className="pointer-events-auto absolute inset-0 z-30" role="menu" aria-label={g.tools}>
      <button type="button" aria-label={t.common.close} onClick={onClose} className="absolute inset-0 bg-background/70 backdrop-blur-[2px]" />
      <div className="absolute bottom-6 left-1/2 h-0 w-0">
        {GUIDE_TOOLS.map((tool, i) => {
          // Spread from 200deg to 340deg on a 250 px arc above the orb.
          const a = ((200 + (140 * i) / (n - 1)) * Math.PI) / 180;
          const x = Math.cos(a) * 280;
          const y = Math.sin(a) * 210;
          const Icon = ICONS[tool.id];
          const why = unavailable[tool.id];
          return (
            <motion.button
              key={tool.id}
              type="button"
              role="menuitem"
              disabled={!!why}
              onClick={() => pick(i)}
              onMouseEnter={() => setFocus(i)}
              initial={shouldAnimate ? { opacity: 0, x: 0, y: 0, scale: 0.6 } : false}
              animate={{ opacity: why ? 0.55 : 1, x, y, scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.03 * i }}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 shadow-elevation-3 ${
                i === focus ? 'border-primary bg-secondary text-foreground' : 'border-border bg-background text-foreground/90'
              }`}
            >
              <Icon className="h-4 w-4 text-primary" />
              <span className="typo-body font-medium">{label[tool.id][0]}</span>
              <kbd className="rounded border border-border px-1.5 font-mono text-xs text-foreground/90">{i + 1}</kbd>
            </motion.button>
          );
        })}
        <div className="absolute left-0 top-0 w-80 -translate-x-1/2 -translate-y-[calc(100%+3.5rem)] text-center">
          <p className="typo-body text-foreground">
            <span className="font-semibold">{label[focused.id][0]}.</span> {label[focused.id][1]}
          </p>
          {unavailable[focused.id] && <p className="mt-1 typo-caption text-status-warning">{unavailable[focused.id]}</p>}
        </div>
      </div>
    </div>
  );
}
