/**
 * Fusion · a category unfolded beside the rail: Current's side-panel content
 * (one row per item: its state, its name, its age or fact, and the action
 * that opens it) in the rail's slim language - a state SHAPE per row instead
 * of a status pill, the age right-aligned, the open action an icon key. The
 * head counts the states the same way the circle's ring does. Esc folds it
 * and hands focus back to its circle.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { motion } from 'framer-motion';
import { useEffect, useRef, type HTMLAttributes } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { FUSION_COPY as F } from './copy';
import { StateGlyph } from './StateGlyph';
import { EASE } from './text';
import { STATE_ORDER, type ManagedCategory } from './useManaged';

export function CategoryPanel({
  category: c,
  top,
  focusFirst,
  onClose,
  zone,
}: {
  category: ManagedCategory;
  /** The circle's centre, in the rail's coordinates: the panel hangs from it. */
  top: number;
  /** Opened from the keyboard: the first row takes focus. */
  focusFirst: boolean;
  onClose: () => void;
  /** The upper rail zone's mark and hover/focus handlers: the panel is part of that zone. */
  zone: HTMLAttributes<HTMLDivElement> & { 'data-fu-zone': string };
}) {
  const { shouldAnimate } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const Icon = c.icon;

  useEffect(() => {
    if (focusFirst) ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [focusFirst]);

  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      onClose();
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 3 },
  );

  return (
    <motion.div
      ref={ref}
      className="fu-panel fu-glass"
      style={{ top, ['--ink' as string]: c.ink }}
      role="region"
      aria-label={c.label}
      data-testid={`companion-fusion-panel-${c.key}`}
      data-fu-zone={zone['data-fu-zone']}
      onPointerEnter={zone.onPointerEnter}
      onPointerLeave={zone.onPointerLeave}
      onFocus={zone.onFocus}
      onBlur={zone.onBlur}
      initial={shouldAnimate ? { opacity: 0, x: 18, scale: 0.97 } : { opacity: 0 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={shouldAnimate ? { opacity: 0, x: 18, scale: 0.97 } : { opacity: 0 }}
      transition={{ duration: shouldAnimate ? 0.24 : 0, ease: EASE }}
    >
      <div className="fu-panel-head">
        <span className="fu-panel-icon" aria-hidden>
          <Icon />
        </span>
        <span className="typo-title text-foreground">{c.label}</span>
        <span className="flex-1" />
        {STATE_ORDER.filter((s) => c.counts[s] > 0).map((s) => (
          <span key={s} className="fu-panel-count typo-caption" aria-label={`${c.counts[s]} ${F.state[s]}`}>
            <StateGlyph state={s} />
            {c.counts[s]}
          </span>
        ))}
        <Tooltip content={`${F.fold} · ${F.keyEsc}`}>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={F.fold} icon={<X className="w-4 h-4" aria-hidden />} />
        </Tooltip>
      </div>
      {c.items.length === 0 ? (
        <p className="typo-body fu-panel-none">{F.categoryEmpty}</p>
      ) : (
        <ul className="fu-panel-list">
          {c.items.map((it) => (
            <li key={it.id} className="fu-row">
              <StateGlyph state={it.state} size={11} />
              <span className="fu-row-text">
                <span className="typo-body text-foreground fu-row-label">{it.label}</span>
                <span className="typo-caption fu-row-meta tabular-nums">
                  <span>{F.state[it.state]}</span>
                  {(it.at || it.note || it.dueAt) && <span aria-hidden>·</span>}
                  {it.at ? (
                    <RelativeTime timestamp={it.at} />
                  ) : it.dueAt ? (
                    <span>
                      {F.due} <AbsoluteTime timestamp={it.dueAt} variant="time" />
                    </span>
                  ) : (
                    it.note && <span>{it.note}</span>
                  )}
                </span>
              </span>
              {it.open ? (
                <Tooltip content={F.open}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={it.open}
                    aria-label={`${F.open}: ${it.label}`}
                    icon={<ArrowUpRight className="w-4 h-4" aria-hidden />}
                  />
                </Tooltip>
              ) : (
                <span aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
      {c.openPage && (
        <div className="fu-panel-foot">
          <Button variant="ghost" size="xs" onClick={c.openPage} iconRight={<ArrowUpRight className="w-3.5 h-3.5" aria-hidden />}>
            {F.openPage}
          </Button>
        </div>
      )}
    </motion.div>
  );
}
